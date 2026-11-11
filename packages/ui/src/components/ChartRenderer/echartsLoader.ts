export type EchartsApi = typeof import("./echartsModules");

let loading: Promise<EchartsApi> | null = null;

/** Load the ECharts core with the report chart modules once (lazy chunk). */
export function loadEcharts(): Promise<EchartsApi> {
  loading ??= import("./echartsModules").catch((err: unknown) => {
    loading = null;
    throw err;
  });
  return loading;
}
