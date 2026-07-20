import styles from "./AssessingBanner.module.css";

export function AssessingBanner() {
  return (
    <div className={styles.banner} aria-live="polite" aria-busy="true">
      <span className={styles.spinner} aria-hidden />
      <div className={styles.copy}>
        <p className={styles.title}>Generating assessment</p>
        <p className={styles.hint}>
          Domain agents are analyzing signals and drafting a recommendation.
          This usually takes a few moments.
        </p>
      </div>
    </div>
  );
}
