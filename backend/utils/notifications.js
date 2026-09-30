export function formatMentions(userIds = []) {
  return userIds.map((userId) => `<@${userId}>`).join(" ");
}
