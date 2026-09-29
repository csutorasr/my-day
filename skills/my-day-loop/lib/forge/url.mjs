// MR/PR web URL → state ext key.
export function extFromUrl(url) {
  let m = /^https?:\/\/[^/]+\/(.+?)\/-\/merge_requests\/(\d+)/.exec(url);
  if (m) return { provider: 'gitlab', ext: `gitlab:${m[1]}!${m[2]}`, project: m[1], iid: Number(m[2]) };
  m = /^https?:\/\/github\.com\/([^/]+\/[^/]+)\/pull\/(\d+)/.exec(url);
  if (m) return { provider: 'github', ext: `github:${m[1]}#${m[2]}`, project: m[1], iid: Number(m[2]) };
  return null;
}
