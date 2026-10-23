// The ONLY input the live Spark server function accepts: the id of the built-in fictional visit. The browser can never send a
// transcript, a speaker map or any other content; the server loads the fixture itself. (Isomorphic: zod only.)
import { z } from "zod";

export const SPARK_FIXTURE_ID = "demo-visit-1";

export const sparkInputSchema = z.object({ fixtureId: z.literal(SPARK_FIXTURE_ID) }).strict();
export type SparkInput = z.infer<typeof sparkInputSchema>;
