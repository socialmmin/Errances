/** Legacy free-text lifecycle sends are disabled by the template-only hotline policy.
 * Booking reminders require verified booking events and approved templates before activation. */
export async function checkAndSendTravelMessagesTwilio() {
 return [{status:'disabled',reason:'Template-only policy: legacy birthday and travel free-text messages are disabled.'}];
}
