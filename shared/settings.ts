import { device } from "@shared/device";

/** Stored values: a flat field_id → value map, with groups as nested objects. */
export type SettingsValues = Record<string, unknown>;

/**
 * Reads the app's stored settings, or null when they are from another schema `version` (see settings.json).
 * Apps can read their settings but not write them; the user changes them on the device or in the web interface.
 */
export async function loadValues(appId: string, version: number): Promise<SettingsValues | null> {
  const doc = await device.AppsSettingsGet({ app_id: appId });
  return doc.version === version ? doc.values : null;
}
