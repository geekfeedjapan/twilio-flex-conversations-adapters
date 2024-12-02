import "@twilio-labs/serverless-runtime-types";
import {
  ServerlessCallback,
  ServerlessFunctionSignature,
} from "@twilio-labs/serverless-runtime-types/types";
import * as LINETypes from "./line_types.private";
import * as Helper from "./line.helper.private";
import { EventMessage } from "@line/bot-sdk";

const { LINEMessageType } = require(Runtime.getFunctions()[
  "api/line/line_types"
].path) as typeof LINETypes;
const { wrappedSendToFlex, lineValidateSignature, wrappedSendToLineResolver } =
  require(Runtime.getFunctions()["api/line/line.helper"].path) as typeof Helper;

export const handler: ServerlessFunctionSignature<
  LINETypes.LINEContext,
  any
> = async (context, event, callback: ServerlessCallback) => {
  console.log("event received - /api/line/incoming: ", event);

  try {
    const lineSignature = event.request.headers["x-line-signature"];
    const validSignature = lineValidateSignature(
      lineSignature,
      JSON.stringify(event),
      context.LINE_CHANNEL_SECRET
    );

    if (!validSignature) return callback("Invalid Signature");

    for (const msg of event.events) {
      if (msg.type === "postback") {
        await wrappedSendToLineResolver(context, msg.source.userId, msg);
        if (msg.postback.data === "98" || msg.postback.data === "99") {
          await wrappedSendToFlex(context, msg.source.userId, {
            type: LINEMessageType.TEXT,
            text:
              msg.postback.data === "98"
                ? "紛失・盗難のお問い合わせ"
                : "いいえ、オペレーターとチャットで相談",
          } as EventMessage);
        }
      } else if (msg.type === "message" && msg.message.text === "LINEで質問") {
        await wrappedSendToLineResolver(context, msg.source.userId, msg);
      } else if (msg.source.userId && msg.message) {
        await wrappedSendToFlex(context, msg.source.userId, msg.message);
      }
    }

    callback(null, { success: true });
  } catch (err) {
    console.error(err);
    callback("outer catch error");
  }
};
