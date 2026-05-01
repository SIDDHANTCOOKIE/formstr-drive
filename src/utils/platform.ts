import { Capacitor } from "@capacitor/core";

export const isNativePlatform = Capacitor.isNativePlatform();
export const currentPlatform = Capacitor.getPlatform();
export const isAndroidPlatform = currentPlatform === "android";
