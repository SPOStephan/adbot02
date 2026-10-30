import type { CSSProperties } from "react";
import { sanitizeFormattedText, stripFormattedText } from "@shared/formattedText";
import { hyphenateGermanHtml } from "@shared/hyphenateGerman";

export function FormattedText({
  value,
  as: Tag = "span",
  className,
  id,
  tabIndex,
  style,
}: {
  value: string;
  as?: "span" | "p" | "h1" | "h2" | "strong" | "small";
  className?: string;
  id?: string;
  tabIndex?: number;
  style?: CSSProperties;
}) {
  const html = hyphenateGermanHtml(sanitizeFormattedText(value));
  const plain = stripFormattedText(html);
  if (!plain && !html.includes("<br>")) {
    return <Tag className={className} id={id} tabIndex={tabIndex} style={style} />;
  }
  return (
    <Tag
      className={className ? `${className} funnel-formatted` : "funnel-formatted"}
      id={id}
      tabIndex={tabIndex}
      style={style}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
