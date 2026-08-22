export interface DashboardSpec {
  title: string;
  chartType: "bar" | "line" | "pie";
  data: Record<string, string | number>[];
  xKey: string;
  yKey: string;
}

const TITLES: Record<string, string> = {
  parts: "Monthly Parts Imported",
  "jobcard-live": "Monthly Job Cards",
  "jobcard-revenue-import": "Monthly Revenue",
  "accident-report": "Accident Reports by Status",
  "stock-assign": "Monthly Stock Assignments",
  "vas-assign": "Monthly VAS Activations",
};

/**
 * Turns an already-computed structured-stats object (grounded DB
 * aggregates — never LLM-generated) into a chart-ready spec for the
 * frontend. The four existing stats shapes (and the two Assign ones added
 * alongside this file) are not uniform — different key names, and
 * accident-report has no time axis at all — so this is a per-sourceType
 * switch rather than one generic mapper.
 */
export function dashboardSpecFor(
  sourceType: string,
  stats: any,
): DashboardSpec | null {
  switch (sourceType) {
    case "parts":
      return {
        title: TITLES.parts,
        chartType: "bar",
        data: stats.monthly,
        xKey: "month",
        yKey: "partCount",
      };
    case "jobcard-live":
      return {
        title: TITLES["jobcard-live"],
        chartType: "bar",
        data: stats.monthly,
        xKey: "month",
        yKey: "jobCardCount",
      };
    case "jobcard-revenue-import":
      return {
        title: TITLES["jobcard-revenue-import"],
        chartType: "line",
        data: stats.timeseries,
        xKey: "bucket",
        yKey: "totalRevenue",
      };
    case "accident-report": {
      const byStatus = stats?.totals?.byStatus ?? {};
      const data = Object.entries(byStatus).map(([status, count]) => ({
        status,
        count: count as number,
      }));
      if (data.length === 0) return null;
      return {
        title: TITLES["accident-report"],
        chartType: "pie",
        data,
        xKey: "status",
        yKey: "count",
      };
    }
    case "stock-assign":
      return {
        title: TITLES["stock-assign"],
        chartType: "bar",
        data: stats.monthly,
        xKey: "month",
        yKey: "assignedCount",
      };
    case "vas-assign":
      return {
        title: TITLES["vas-assign"],
        chartType: "bar",
        data: stats.monthly,
        xKey: "month",
        yKey: "activationCount",
      };
    default:
      return null;
  }
}
