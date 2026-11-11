import { CalendarDays, ClipboardCheck, Home, Mail, MessageCircle, Pill, SlidersHorizontal, Stethoscope, Users } from "lucide-react";

/** Destinations shown as pills on tablet and desktop. Same labels and order as the previous sidebar. */
export const pillDestinations = [
  { to: "/family", label: "Dashboard", icon: Home },
  { to: "/members", label: "Family Members", icon: Users },
  { to: "/visits", label: "Visits", icon: Stethoscope },
  { to: "/meds", label: "Meds", icon: Pill },
  { to: "/coverage", label: "Coverage", icon: CalendarDays },
  { to: "/handoffs", label: "Handoffs", icon: ClipboardCheck },
  { to: "/digest", label: "Digest", icon: Mail },
] as const;

/** Phone bottom bar: four destinations around the centred Handoff action. */
export const phoneBarLeft = [
  { to: "/family", label: "Home", icon: Home },
  { to: "/visits", label: "Visits", icon: Stethoscope },
] as const;
export const phoneBarRight = [
  { to: "/meds", label: "Meds", icon: Pill },
  { to: "/coverage", label: "Coverage", icon: CalendarDays },
] as const;

/** Phone menu sheet: the destinations the bottom bar has no room for. */
export const phoneMenu = [
  { to: "/members", label: "Family Members", hint: "Care team and who can see what", icon: Users },
  { to: "/handoffs", label: "Handoffs", hint: "Quick check-in and past handoffs", icon: ClipboardCheck },
  { to: "/digest", label: "Digest", hint: "The weekly summary", icon: Mail },
  { to: "/ask", label: "Ask Pendia", hint: "Not available yet", icon: MessageCircle },
  { to: "/preferences", label: "Preferences & Accessibility", hint: "Text size, contrast, motion, buttons", icon: SlidersHorizontal },
] as const;
