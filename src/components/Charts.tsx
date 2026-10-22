/**
 * Population and urban-footprint charts (ECharts, tree-shaken).
 * The population series is sourced; the footprint series is the output of
 * the schematic growth model and is drawn dashed and labelled as such.
 */
import { useEffect, useRef } from "react";
import * as echarts from "echarts/core";
import { LineChart } from "echarts/charts";
import { GridComponent, MarkLineComponent, TooltipComponent } from "echarts/components";
import { CanvasRenderer } from "echarts/renderers";
import { PALETTE } from "../map/palette";

echarts.use([LineChart, GridComponent, TooltipComponent, MarkLineComponent, CanvasRenderer]);

interface SeriesChartProps {
  label: string;
  points: [number, number][];
  year: number;
  colour: string;
  dashed?: boolean;
  format: (v: number) => string;
  onPick?: (year: number) => void;
}

const axisStyle = {
  axisLine: { lineStyle: { color: "rgba(242,232,213,0.25)" } },
  axisLabel: { color: "rgba(242,232,213,0.6)", fontFamily: "IBM Plex Mono, monospace", fontSize: 10 },
  splitLine: { lineStyle: { color: "rgba(73,234,216,0.07)" } },
};

function SeriesChart({ label, points, year, colour, dashed = false, format, onPick }: SeriesChartProps) {
  const host = useRef<HTMLDivElement>(null);
  const chart = useRef<echarts.ECharts | null>(null);

  useEffect(() => {
    if (!host.current) return;
    const instance = echarts.init(host.current, undefined, { renderer: "canvas" });
    chart.current = instance;
    const observer = new ResizeObserver(() => instance.resize());
    observer.observe(host.current);
    instance.on("click", (params) => {
      const value = (params as { value?: unknown }).value;
      if (Array.isArray(value) && typeof value[0] === "number") onPick?.(value[0]);
    });
    return () => {
      observer.disconnect();
      instance.dispose();
      chart.current = null;
    };
  }, [onPick]);

  useEffect(() => {
    chart.current?.setOption({
      animation: false,
      grid: { left: 44, right: 10, top: 12, bottom: 22 },
      tooltip: {
        trigger: "axis",
        backgroundColor: "rgba(7,25,35,0.95)",
        borderColor: "rgba(73,234,216,0.3)",
        textStyle: { color: PALETTE.cream, fontSize: 12 },
        formatter: (params: unknown) => {
          const p = (params as { value: [number, number] }[])[0];
          return p ? `${p.value[0]}<br/><b>${format(p.value[1])}</b> ${label}` : "";
        },
      },
      xAxis: { type: "value", min: 1750, max: 2030, interval: 50, ...axisStyle, axisLabel: { ...axisStyle.axisLabel, formatter: (v: number) => String(v) }, splitLine: { show: false } },
      yAxis: { type: "value", ...axisStyle, axisLabel: { ...axisStyle.axisLabel, formatter: (v: number) => format(v) } },
      series: [
        {
          type: "line",
          data: points,
          smooth: 0.25,
          symbol: "circle",
          symbolSize: 4,
          lineStyle: { color: colour, width: 2, type: dashed ? "dashed" : "solid" },
          itemStyle: { color: colour },
          areaStyle: { color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [{ offset: 0, color: `${colour}55` }, { offset: 1, color: `${colour}00` }]) },
          markLine: {
            silent: true,
            symbol: "none",
            label: { show: false },
            lineStyle: { color: PALETTE.amber, width: 1.5, type: "solid" },
            data: [{ xAxis: Math.min(2030, Math.max(1750, year)) }],
          },
        },
      ],
    });
  }, [points, year, colour, dashed, format, label]);

  return <div ref={host} className="chart" role="img" aria-label={`${label} chart`} />;
}

const thousands = (v: number) => (v >= 1000 ? `${Math.round(v / 1000)}k` : String(v));
const km2 = (v: number) => `${v.toFixed(v < 10 ? 1 : 0)}`;

export function PopulationChart({ series, year, onPick }: { series: { year: number; population: number }[]; year: number; onPick?: (y: number) => void }) {
  return <SeriesChart label="people" points={series.map((p) => [p.year, p.population])} year={year} colour={PALETTE.cyan} format={thousands} onPick={onPick} />;
}

export function FootprintChart({ series, year, digitised = false }: { series: { year: number; area_km2: number }[]; year: number; digitised?: boolean }) {
  const points = series.filter((p) => p.year >= 1750).map((p) => [p.year, p.area_km2] as [number, number]);
  return <SeriesChart label={digitised ? "km² (digitised extents)" : "km² (schematic model)"} points={points} year={year} colour={PALETTE.amber} dashed={!digitised} format={km2} />;
}
