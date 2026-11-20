// The only ECharts modules SaiFlow reports use (bar, line, pie with grid, tooltip, legend,
// dataset; canvas renderer). Imported lazily by echartsLoader so ECharts is a separate chunk.
import { BarChart, LineChart, PieChart } from "echarts/charts";
import { DatasetComponent, GridComponent, LegendComponent, TooltipComponent } from "echarts/components";
import { getInstanceByDom, init, use as registerEchartsModules } from "echarts/core";
import { CanvasRenderer } from "echarts/renderers";

registerEchartsModules([BarChart, LineChart, PieChart, GridComponent, TooltipComponent, LegendComponent, DatasetComponent, CanvasRenderer]);

export { getInstanceByDom, init };
