// `aiReviewer` is one account or a comma-separated list; without it, fall back to the provider's bot naming.
export const isAiReviewer = (user, aiReviewer, botPattern) => {
  const list = String(aiReviewer ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  return list.length ? list.includes(user) : botPattern.test(user);
};
