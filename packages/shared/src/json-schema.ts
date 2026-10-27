import { toJSONSchema } from "zod";
import { CritiqueReport } from "./schemas/critique-report.ts";
import { EditCommand } from "./schemas/edit-command.ts";
import { LookSpec } from "./schemas/look-spec.ts";
import { WearableSpec } from "./schemas/wearable-spec.ts";

export const LookSpecJsonSchema = toJSONSchema(LookSpec);
export const WearableSpecJsonSchema = toJSONSchema(WearableSpec);
export const EditCommandJsonSchema = toJSONSchema(EditCommand);
export const CritiqueReportJsonSchema = toJSONSchema(CritiqueReport);
