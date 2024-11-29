// Imports global types
import "@twilio-labs/serverless-runtime-types";

// Fetches specific types
import {
  ServerlessCallback,
  ServerlessFunctionSignature,
} from "@twilio-labs/serverless-runtime-types/types";
import * as LINETypes from "./line_types.private";
import * as Helper from "./line.helper.private";
import { EventMessage } from "@line/bot-sdk";
import { SERVICE_URL, CAMPAIGN_URL } from "./config.private";

// Load Libraries
const { LINEMessageType } = <typeof LINETypes>(
  require(Runtime.getFunctions()["api/line/line_types"].path)
);
const { wrappedSendToFlex, lineValidateSignature, wrappedSendToLineResolver } =
  <typeof Helper>require(Runtime.getFunctions()["api/line/line.helper"].path);
export const handler: ServerlessFunctionSignature<
  LINETypes.LINEContext,
  any
> = async (context, event, callback: ServerlessCallback) => {
  console.log("event received - /api/line/incoming: ", event);
  try {
    // Debug: Console Log Incoming Events
    console.log("---Start of Raw Event---");
    console.log(event);
    console.log(event.request);
    console.log(event.destination);
    console.log(event.events);
    console.log("---End of Raw Event---");

    // Step 1: Verify LINE signature
    const lineSignature = event.request.headers["x-line-signature"];
    const lineSignatureBody = JSON.stringify({
      destination: event.destination,
      events: event.events,
    });
    const validSignature = lineValidateSignature(
      lineSignature,
      lineSignatureBody,
      context.LINE_CHANNEL_SECRET
    );
    if (!validSignature) {
      console.log("Invalid Signature");
      return callback("Invalid Signature");
    }

    // Step 2: Process Twilio Conversations
    for (const msg of event.events) {
      // postbackとLINEで質問の処理を分離
      if (msg.type === "postback") {
        if (msg.postback.data === "98" || msg.postback.data === "99") {
          // オペレーターと繋ぐ処理を直接実行
          await wrappedSendToFlex(context, msg.source.userId, {
            type: LINEMessageType.TEXT,
            text:
              msg.postback.data === "98"
                ? "紛失・盗難のお問い合わせ"
                : "いいえ、オペレーターとチャットで相談",
          } as EventMessage);
        } else {
          // その他のpostbackの処理
          await wrappedSendToLineResolver(context, msg.source.userId, msg);
        }
        return callback(null, { success: true });
      }

      if (msg.type === "message" && msg.message.text === "LINEで質問") {
        await wrappedSendToLineResolver(context, msg.source.userId, msg);
        return callback(null, { success: true });
      }

      // 通常のメッセージ処理
      if (msg.source.userId && msg.message) {
        await wrappedSendToFlex(context, msg.source.userId, msg.message);
      }
    }
    return callback(null, {
      success: true,
    });
  } catch (err) {
    console.log(err);
    return callback("outer catch error");
  }
};
