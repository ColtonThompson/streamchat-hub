/**
 * renderer/src/components/MentionChip.tsx
 *
 * WHAT: Draws one "@username" inside a message as a small rounded chip so it stands out.
 *
 * It looks different when the mention is of YOU (the signed-in Twitch account): a solid accent
 * chip instead of a soft tinted one, so a ping to you is easy to spot while scrolling.
 *
 * STYLING: the look lives in styles.css (`.mention`, `.mention[data-me='true']`). This component only
 * decides which variant to draw.
 */
export function MentionChip({ text, name, me }: { text: string; name: string; me?: string }) {
  // `me` is your lowercase login (or undefined when signed out). Twitch names are case-insensitive.
  const isMe = !!me && name.toLowerCase() === me
  return (
    <span className="mention" data-me={isMe} title={isMe ? 'Mentions you' : undefined}>
      {text}
    </span>
  )
}
