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
import { adbotIconMap } from "./adbotIcons";

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
}: {
  name: string;
  className?: string;
  color?: string;
}) {
  const style = color ? { color } : undefined;
  if (isAdbotFunnelIcon(name)) {
    const Icon = adbotIconMap[name];
    return <span className={className} style={style}><Icon className="size-full" /></span>;
  }
  const Icon = lucideIcons[name as LucideFunnelIcon] ?? Sparkles;
  return <Icon className={className} style={style} aria-hidden="true" strokeWidth={1.8} />;
}
