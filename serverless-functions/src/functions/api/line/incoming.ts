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
    // -- Handle Multiple Events Recieved in Webhook
    for (const msg of event.events) {
      if (
        msg.type === "postback" ||
        !!(msg.type === "message" && msg.message.text === "LINEで質問")
      ) {
        await wrappedSendToLineResolver(context, msg.source.userId, msg);
        if (
          !(
            msg.type === "postback" &&
            (msg.postback.data === "99" || msg.postback.data === "98")
          )
        ) {
          return callback(null, {
            success: true,
          });
        } else {
          // オペレーターと繋ぐ
          await wrappedSendToFlex(context, msg.source.userId, {
            type: LINEMessageType.TEXT,
            text:
              msg.postback.data === "98"
                ? "紛失・盗難のお問い合わせ"
                : "いいえ、オペレーターとチャットで相談",
          } as EventMessage);
          return callback(null, {
            success: true,
          });
        }
      }
      // -- Process Each Event
      if (msg.source.userId && msg.message) {
        const userId = msg.source.userId;
        const message = msg.message;
        await wrappedSendToFlex(context, userId, message);
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
