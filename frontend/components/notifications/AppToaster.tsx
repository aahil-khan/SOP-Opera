"use client";

import { ToastContainer } from "react-toastify";
import "react-toastify/dist/ReactToastify.css";
import { useTheme } from "@/components/theme/ThemeProvider";
import styles from "./AppToaster.module.css";

export function AppToaster() {
  const { theme } = useTheme();
  const toastTheme = theme === "light" ? "light" : "dark";

  return (
    <ToastContainer
      className={styles.container}
      toastClassName={styles.toast}
      position="top-right"
      theme={toastTheme}
      limit={2}
      newestOnTop
      closeOnClick={false}
      draggable={false}
      pauseOnHover
      pauseOnFocusLoss
      autoClose={5000}
      hideProgressBar={false}
      closeButton
      style={{ top: "calc(var(--nav-height, 48px) + 8px)", right: 16 }}
    />
  );
}
