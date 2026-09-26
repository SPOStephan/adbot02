import type { StartBadge } from "@shared/funnel";
import { resolveBadgeIcon, resolveBadgeIconPosition } from "@shared/startLayout";
import { FunnelIcon } from "./FunnelIcon";

export function StartBadgeContent({
  badge,
  color,
}: {
  badge: StartBadge;
  color: string;
}) {
  const icon = resolveBadgeIcon(badge.icon);
  const position = resolveBadgeIconPosition(badge.iconPosition);
  const mark = icon
    ? <FunnelIcon name={icon} className="funnel-start-benefits-badge-icon" color={color} fit="picker" />
    : null;
  const text = <span>{badge.label}</span>;
  return position === "right" ? <>{text}{mark}</> : <>{mark}{text}</>;
}
