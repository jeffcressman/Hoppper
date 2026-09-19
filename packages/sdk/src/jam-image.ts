// A jam's cover image. Endlesss keeps it on its CDN under the jam's couch ID
// (the public rifffs API reports it as `image`), so the URL needs no request.
// Jams without one answer 403. See docs/protocol/overview.md, "Jam image".
const AVATARS = 'https://endlesss.ams3.cdn.digitaloceanspaces.com/attachments/avatars/';

export function jamImageUrl(jamId: string): string {
  return AVATARS + encodeURIComponent(jamId);
}
