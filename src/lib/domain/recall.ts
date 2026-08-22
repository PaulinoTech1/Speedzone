import { z } from "zod";

export type RecallCampaign = {
  campaignNumber: string;
  component: string;
  summary: string;
  consequence: string;
  remedy: string;
  reportReceivedDate: string | null;
  parkIt: boolean;
  parkOutSide: boolean;
};

export const recallCampaignSchema = z.object({
  campaignNumber: z.string(),
  component: z.string(),
  summary: z.string(),
  consequence: z.string(),
  remedy: z.string(),
  reportReceivedDate: z.string().nullable(),
  parkIt: z.boolean(),
  parkOutSide: z.boolean(),
});

export const recallCheckResponseSchema = z.object({
  ok: z.literal(true),
  vehicle: z.object({
    year: z.number().int().nullable(),
    make: z.string().nullable(),
    model: z.string().nullable(),
    trim: z.string().nullable(),
  }),
  campaigns: z.array(recallCampaignSchema),
  warning: z.string().nullable(),
});

export type RecallCheckResponse = z.infer<typeof recallCheckResponseSchema>;
