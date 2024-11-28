// Import Libraries
import crypto from "crypto";
import fetch, { Response } from "node-fetch";
import { Context } from "@twilio-labs/serverless-runtime-types/types";
import {
  ClientConfig,
  Client,
  TextMessage,
  ImageMessage,
  VideoMessage,
  EventMessage,
  PostbackEvent,
  MessageEvent,
} from "@line/bot-sdk";
import * as Util from "../common/common.helper.private";
import * as LINETypes from "./line_types.private";

// Load TypeScript - Types
const { LINEMessageType } = <typeof LINETypes>(
  require(Runtime.getFunctions()["api/line/line_types"].path)
);

// Load Twilio Helper
const {
  twilioUploadMediaResource,
  twilioFindExistingConversation,
  twilioCreateConversation,
  twilioCreateParticipant,
  twilioCreateScopedWebhookStudio,
  twilioCreateScopedWebhook,
  twilioCreateMessage,
} = <typeof Util>(
  require(Runtime.getFunctions()["api/common/common.helper"].path)
);

export const wrappedSendToLineResolver = async (
  context: Context<LINETypes.LINEContext>,
  userId: string,
  msg: MessageEvent | PostbackEvent
) => {
  const resolvers = resolver[msg.type as keyof ResolverType];
  if (resolvers) {
    const createMessages =
      resolvers[
        msg.type === "message"
          ? (msg as MessageEvent).message.type === "text"
            ? ((msg as MessageEvent).message as TextMessage).text
            : ""
          : (msg as PostbackEvent).postback.data
      ];
    const clientConfig: ClientConfig = {
      channelAccessToken: context.LINE_CHANNEL_ACCESS_TOKEN,
      channelSecret: context.LINE_CHANNEL_SECRET,
    };
    const lineClient = new Client(clientConfig);
    // LINE APIでメッセージを送信
    for (const message of createMessages) {
      if (message) {
        await lineClient.pushMessage(userId, message);
      }
    }
  } else {
    throw new Error("No resolver found");
  }
};

type ResolverType = {
  message: { [key: string]: any[] };
  postback: { [key: string]: any[] };
};

const resolver: ResolverType = {
  message: {
    LINEで質問: [
      {
        type: "template",
        altText: "よくあるお問い合わせ",
        template: {
          type: "buttons",
          title: "よくあるお問い合わせ",
          text: "本日はどのようなご相談でしょうか",
          actions: [
            {
              type: "postback",
              label: "キャンペーンについて",
              data: "11",
              displayText: "キャンペーンについて",
            },
            {
              type: "postback",
              label: "サービスについて",
              data: "12",
              displayText: "サービスについて",
            },
            {
              type: "postback",
              label: "紛失・盗難",
              data: "13",
              displayText: "紛失・盗難",
            },
          ],
        },
      },
    ],
  },
  postback: {
    11: [
      {
        type: "template",
        altText: "キャンペーンについて",
        template: {
          type: "buttons",
          title: "キャンペーンについて",
          text: "現在実施中のキャンペーンは下記URLをご覧ください",
          actions: [
            {
              type: "uri",
              label: "キャンペーンページ",
              uri: process.env.CAMPAIGN_URL,
            },
          ],
        },
      },
      {
        type: "template",
        altText: "解決されましたでしょうか",
        template: {
          type: "buttons",
          title: "解決確認",
          text: "解決されましたでしょうか",
          actions: [
            {
              type: "postback",
              label: "はい、メニューに戻る",
              data: "21",
              displayText: "はい、メニューに戻る",
            },
            {
              type: "postback",
              label: "いいえ、オペレーターとチャットで相談",
              data: "22",
              displayText: "いいえ、オペレーターとチャットで相談",
            },
          ],
        },
      },
    ],
    21: [],
    22: [],
  },
};

export const wrappedSendToFlex = async (
  context: Context<LINETypes.LINEContext>,
  userId: string,
  message: EventMessage
) => {
  const client = context.getTwilioClient();

  // Step 1: Check for any existing conversation. If doesn't exist, create a new conversation -> add participant -> add webhooks
  const clientConfig: ClientConfig = {
    channelAccessToken: context.LINE_CHANNEL_ACCESS_TOKEN,
    channelSecret: context.LINE_CHANNEL_SECRET,
  };
  const lineClient = new Client(clientConfig);
  const userProfile = await lineClient.getProfile(userId);
  const identity = `line: ${userProfile.displayName}`;
  const attributes = {
    type: "line",
    userId: userId,
    userName: userProfile.displayName,
  };
  console.log(identity);

  let { conversationSid, chatServiceSid } =
    await twilioFindExistingConversation(client, identity);

  console.log(`Old Convo ID: ${conversationSid}`);
  console.log(`[Via Existing] Chat Service ID: ${chatServiceSid}`);

  if (!conversationSid) {
    // -- Create Conversation
    const createConversationResult = await twilioCreateConversation(
      "LINE",
      client,
      userId,
      {}
    );
    conversationSid = createConversationResult.conversationSid;
    chatServiceSid = createConversationResult.chatServiceSid;
    // -- Add Participant into Conversation
    await twilioCreateParticipant(
      client,
      conversationSid,
      identity,
      attributes
    );
    // -- Create Webhook (Conversation Scoped) for Studio
    await twilioCreateScopedWebhookStudio(
      client,
      conversationSid,
      context.LINE_STUDIO_FLOW_SID
    );
    // -- Create Webhook (Conversation Scoped) for Outgoing Conversation (Flex to LINE)
    let domainName = context.DOMAIN_NAME;
    if (
      context.DOMAIN_NAME_OVERRIDE &&
      context.DOMAIN_NAME_OVERRIDE !== "<YOUR_DOMAIN_NAME_OVERRIDE>"
    ) {
      domainName = context.DOMAIN_NAME_OVERRIDE;
    }
    await twilioCreateScopedWebhook(
      client,
      conversationSid,
      userId,
      domainName,
      "api/line/outgoing"
    );
  }

  console.log("Message type is: ", message.type);

  // Step 2: Add Message to Conversation
  // -- Process Message Type
  if (message.type === LINEMessageType.TEXT) {
    // -- Message Type: text
    await twilioCreateMessage(
      client,
      conversationSid,
      identity,
      (message as TextMessage).text,
      null,
      attributes
    );
  } else if (
    message.type === LINEMessageType.IMAGE ||
    message.type === LINEMessageType.VIDEO
  ) {
    // -- Message Type: image, video
    console.log("--- Message Type: Media (Verbose) ---");
    console.log(`Content Provider Type: ${message.contentProvider.type}`);

    if (chatServiceSid == undefined) {
      console.log("Chat Service SID is undefined");
      return;
    }

    const downloadFile = await lineGetMessageContent(context, message.id);
    const data = downloadFile.body;
    const fileType = downloadFile.headers.get("content-type");

    if (fileType == undefined) {
      console.log("File Type is undefined");
      return;
    }

    console.log(`Incoming File Type (from HTTP Header): ${fileType}`);
    console.log("Uploading to Twilio MCS...");
    let uploadMCSResult = await twilioUploadMediaResource(
      { accountSid: context.ACCOUNT_SID, authToken: context.AUTH_TOKEN },
      chatServiceSid,
      fileType,
      data,
      "file"
    );

    if (!uploadMCSResult.sid) {
      return false;
    }
    console.log(`Uploaded Twilio Media SID: ${uploadMCSResult.sid}`);
    await twilioCreateMessage(
      client,
      conversationSid,
      identity,
      "file",
      uploadMCSResult.sid
    );
  }
};

/**
 * Validate LINE Webhook Signature
 * @param {string} signature - Webhook
 * @param {string} body - API Response Payload
 * @param {string} secret - LINE Secret Key
 * @return {boolean} - Signature's validity
 */
export const lineValidateSignature = (
  signature: string,
  body: string,
  secret: string
) => {
  // Generate HMAC-256 Digest
  const digest = crypto
    .createHmac("sha256", secret)
    .update(body)
    .digest("base64");
  if (digest === signature) {
    return true;
  } else {
    return false;
  }
};

/**
 * Send LINE Text Message
 * @param {LINETypes.LINEContext} context - LINE Context
 * @param {string} userId - LINE User ID
 * @param {string} message - Message
 * @returns {boolean} - Message sending status
 */
export const lineSendTextMessage = async (
  context: Context<LINETypes.LINEContext>,
  userId: string,
  message: string
) => {
  try {
    // Initialise LINE Client
    const clientConfig: ClientConfig = {
      channelAccessToken: context.LINE_CHANNEL_ACCESS_TOKEN,
      channelSecret: context.LINE_CHANNEL_SECRET,
    };
    const client = new Client(clientConfig);

    // Send Text Message
    const sendMessagePayload: TextMessage = {
      type: "text",
      text: message,
    };
    const result = await client.pushMessage(userId, sendMessagePayload);
    console.log("lineSendTextMessage: ", result);
    return true;
  } catch (err) {
    console.log(err);
    return false;
  }
};

/**
 * Send LINE Media Message
 * @param {LINETypes.LINEContext} context - LINE Context
 * @param {string} userId - LINE User ID
 * @param {string} type - Media Type - Image or Video
 * @param {string} contentUrl - URL of Image or Video
 * @returns {boolean} - Message sending status
 */
export const lineSendMediaMessage = async (
  context: Context<LINETypes.LINEContext>,
  userId: string,
  type: "image" | "video",
  contentUrl: string
) => {
  try {
    // Initialise LINE Client
    const clientConfig: ClientConfig = {
      channelAccessToken: context.LINE_CHANNEL_ACCESS_TOKEN,
      channelSecret: context.LINE_CHANNEL_SECRET,
    };
    const client = new Client(clientConfig);

    // Send Text Message
    const sendMessagePayload: ImageMessage | VideoMessage = {
      type: type,
      originalContentUrl: contentUrl,
      previewImageUrl: contentUrl,
    };
    const result = await client.pushMessage(userId, sendMessagePayload);
    console.log("lineSendMediaMessage: ", result);
    return true;
  } catch (err) {
    console.log(err);
    return false;
  }
};

/**
 * Get LINE Message Content
 * @param {LINETypes.LINEContext} context - LINE Context
 * @param {string} messageId - LINE Message ID
 * @returns {Response} - HTTP call response object
 */
export const lineGetMessageContent = async (
  context: Context<LINETypes.LINEContext>,
  messageID: string
) => {
  try {
    // Initialise LINE Client
    const response = await fetch(
      `https://api-data.line.me/v2/bot/message/${messageID}/content`,
      {
        method: "get",
        headers: {
          Authorization: `Bearer ${context.LINE_CHANNEL_ACCESS_TOKEN}`,
        },
      }
    );
    return response;
  } catch (err) {
    console.log(err);
    throw err;
  }
};
