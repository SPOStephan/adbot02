import { sanitizeFormattedText, stripFormattedText } from "@shared/formattedText";
import { hyphenateGermanHtml } from "@shared/hyphenateGerman";

export function FormattedText({
  value,
  as: Tag = "span",
  className,
  id,
  tabIndex,
}: {
  value: string;
  as?: "span" | "p" | "h1" | "h2" | "strong" | "small";
  className?: string;
  id?: string;
  tabIndex?: number;
}) {
  const html = hyphenateGermanHtml(sanitizeFormattedText(value));
  const plain = stripFormattedText(html);
  if (!plain && !html.includes("<br>")) {
    return <Tag className={className} id={id} tabIndex={tabIndex} />;
  }
  return (
    <Tag
      className={className ? `${className} funnel-formatted` : "funnel-formatted"}
      id={id}
      tabIndex={tabIndex}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
