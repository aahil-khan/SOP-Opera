"use client";

import { Toaster } from "sonner";
import { useTheme } from "@/components/theme/ThemeProvider";
import styles from "./AppToaster.module.css";

export function AppToaster() {
  const { theme } = useTheme();
  const sonnerTheme = theme === "light" ? "light" : "dark";

  return (
    <Toaster
      theme={sonnerTheme}
      position="top-right"
      closeButton
      richColors={false}
      offset={{ top: "56px", right: "16px" }}
      mobileOffset={{ top: "56px", right: "12px" }}
      toastOptions={{
        className: styles.toast,
        classNames: {
          toast: styles.toast,
          title: styles.title,
          description: styles.description,
          actionButton: styles.action,
          cancelButton: styles.cancel,
          closeButton: styles.close,
        },
      }}
    />
  );
}
