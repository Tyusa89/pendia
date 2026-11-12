import * as React from "react";
import * as SwitchPrimitives from "@radix-ui/react-switch";

import { cn } from "@/lib/utils";

type SwitchProps = React.ComponentPropsWithoutRef<typeof SwitchPrimitives.Root> & {
  /** "touch": the control itself is at least 44px tall (for new controls; the default keeps the existing 32px track). */
  size?: "default" | "touch";
};

const Switch = React.forwardRef<React.ElementRef<typeof SwitchPrimitives.Root>, SwitchProps>(
  ({ className, size = "default", ...props }, ref) => (
    <SwitchPrimitives.Root
      className={cn(
        "peer relative inline-flex shrink-0 before:absolute before:-inset-2 before:content-[''] cursor-pointer items-center rounded-full border-2 border-transparent shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-50 data-[state=checked]:bg-success data-[state=unchecked]:bg-[#7b8599]",
        size === "touch" ? "h-11 w-[4.5rem]" : "h-8 w-14",
        className,
      )}
      {...props}
      ref={ref}
    >
      <SwitchPrimitives.Thumb
        className={cn(
          "pointer-events-none block rounded-full bg-white shadow-lg ring-0 transition-transform data-[state=unchecked]:translate-x-0",
          size === "touch"
            ? "size-9 data-[state=checked]:translate-x-[2rem]"
            : "size-6 data-[state=checked]:translate-x-[1.625rem]",
        )}
      />
    </SwitchPrimitives.Root>
  ),
);
Switch.displayName = SwitchPrimitives.Root.displayName;

export { Switch };
