import {
  BadgeCheck,
  Banknote,
  Bell,
  BookOpen,
  Brain,
  BriefcaseBusiness,
  Building2,
  CalendarDays,
  Car,
  ChartLine,
  Check,
  CircleHelp,
  Clock3,
  Coffee,
  Construction,
  Crown,
  Dumbbell,
  Factory,
  FileText,
  Flag,
  Gem,
  Globe,
  GraduationCap,
  Handshake,
  Heart,
  Home,
  Laptop,
  Leaf,
  Lightbulb,
  Mail,
  MapPin,
  MessageCircle,
  Megaphone,
  Phone,
  Plane,
  Rocket,
  Search,
  ShieldCheck,
  ShoppingCart,
  Smile,
  Sparkles,
  Star,
  Target,
  Trophy,
  Truck,
  UserCheck,
  Users,
  Wrench,
  Zap,
} from "lucide-react";
import type { LucideFunnelIcon } from "@shared/funnel";
import { isAdbotFunnelIcon } from "@shared/funnel";
import { getFunnelLibraryIcon } from "@shared/funnelIconRuntime";
import { sanitizeFunnelIconSvg } from "@shared/funnelIconSvg";
import { AdbotIconFitContext, type AdbotIconFit, adbotIconMap } from "./adbotIcons";

const lucideIcons = {
  "badge-check": BadgeCheck,
  banknote: Banknote,
  bell: Bell,
  "book-open": BookOpen,
  brain: Brain,
  briefcase: BriefcaseBusiness,
  building: Building2,
  calendar: CalendarDays,
  car: Car,
  "chart-line": ChartLine,
  check: Check,
  "circle-help": CircleHelp,
  clock: Clock3,
  coffee: Coffee,
  construction: Construction,
  crown: Crown,
  dumbbell: Dumbbell,
  factory: Factory,
  "file-text": FileText,
  flag: Flag,
  gem: Gem,
  globe: Globe,
  "graduation-cap": GraduationCap,
  handshake: Handshake,
  heart: Heart,
  home: Home,
  laptop: Laptop,
  leaf: Leaf,
  lightbulb: Lightbulb,
  mail: Mail,
  "map-pin": MapPin,
  "message-circle": MessageCircle,
  megaphone: Megaphone,
  phone: Phone,
  plane: Plane,
  rocket: Rocket,
  search: Search,
  "shield-check": ShieldCheck,
  "shopping-cart": ShoppingCart,
  smile: Smile,
  sparkles: Sparkles,
  star: Star,
  target: Target,
  trophy: Trophy,
  truck: Truck,
  "user-check": UserCheck,
  users: Users,
  wrench: Wrench,
  zap: Zap,
} satisfies Record<LucideFunnelIcon, typeof Check>;

export function FunnelIcon({
  name,
  className,
  color,
  fit = "tile",
}: {
  name: string;
  className?: string;
  color?: string;
  fit?: AdbotIconFit;
}) {
  const style = color ? { color } : undefined;
  const ownClass = ["funnel-icon-own", className].filter(Boolean).join(" ");
  const custom = getFunnelLibraryIcon(name);
  if (custom) {
    const svg = sanitizeFunnelIconSvg(custom.svg);
    if (svg) {
      return <span className={ownClass} data-icon-kind="custom" data-icon-fit={fit} style={style} dangerouslySetInnerHTML={{ __html: svg }} />;
    }
  }
  if (isAdbotFunnelIcon(name)) {
    const Icon = adbotIconMap[name];
    return (
      <AdbotIconFitContext.Provider value={fit}>
        <span className={ownClass} data-icon-kind="adbot" data-icon-fit={fit} style={style}><Icon className="size-full" /></span>
      </AdbotIconFitContext.Provider>
    );
  }
  const Icon = lucideIcons[name as LucideFunnelIcon] ?? Sparkles;
  return <Icon className={className} style={style} aria-hidden="true" strokeWidth={1.8} />;
}
