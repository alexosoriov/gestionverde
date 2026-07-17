import { integer, real, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const liveTracking = sqliteTable("live_tracking", {
  id: text("id").primaryKey(),
  lat: real("lat").notNull(),
  lng: real("lng").notNull(),
  speed: real("speed"),
  heading: real("heading"),
  accuracy: real("accuracy"),
  nextStop: text("next_stop"),
  completed: integer("completed").notNull().default(0),
  total: integer("total").notNull().default(39),
  status: text("status").notNull().default("active"),
  updatedAt: integer("updated_at").notNull(),
});
