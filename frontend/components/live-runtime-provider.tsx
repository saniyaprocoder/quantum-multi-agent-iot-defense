"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useReducer } from "react";
import { useLiveDashboard, type TelemetryPoint } from "@/hooks/use-live-dashboard";
import type { Attack, DashboardSnapshot, LiveConnectionState } from "@/types/api";
import { scenarioFocus, validFocus, type ScenarioFocus } from "@/features/scenario-focus";
import { ScenarioContextBar } from "./scenario-context";
import { AppNavigation } from "./app-navigation";
import { ErrorScreen, LoadingScreen } from "./ui";
import { SimulationControls } from "./simulation-controls";
import { SystemHeader } from "./system-header";

interface LiveRuntimeValue {
  data: DashboardSnapshot;
  telemetry: Record<string, TelemetryPoint[]>;
  connection: LiveConnectionState;
  refreshing: boolean;
  refresh: () => Promise<void>;
  selectedIncident?: string;
  setSelectedIncident: (value: string) => void;
  focusedScenario: ScenarioFocus | null;
  focusScenario: (attack: Attack) => void;
  clearScenarioFocus: () => void;
  beginScenarioFocus: () => (attack: Attack) => void;
}

const LiveRuntimeContext = createContext<LiveRuntimeValue | null>(null);

interface SelectionState { epoch?: number; focus: ScenarioFocus | null; incident?: string; intent?: symbol }
type SelectionAction = { type: "epoch"; epoch?: number } | { type: "clear" } | { type: "incident"; value: string }
  | { type: "begin"; token: symbol } | { type: "commit"; token: symbol; focus: ScenarioFocus };
function selectionReducer(state: SelectionState, action: SelectionAction): SelectionState {
  if (action.type === "epoch") return { epoch: action.epoch, focus: null };
  if (action.type === "clear") return { epoch: state.epoch, focus: null };
  if (action.type === "incident") return { ...state, incident: action.value };
  if (action.type === "begin") return { ...state, intent: action.token };
  if (state.intent !== action.token || state.epoch !== action.focus.epoch) return state;
  return { ...state, focus: action.focus, incident: action.focus.correlationId };
}

export function LiveRuntimeProvider({ children }: { children: React.ReactNode }) {
  const live = useLiveDashboard();
  const { setFocusedCorrelation } = live;
  const [selection, dispatch] = useReducer(selectionReducer, { focus: null });
  const epoch = live.runtimeEpoch ?? live.data?.epoch;
  // A guarded render adjustment clears selection before children render a new epoch.
  if (epoch !== selection.epoch) dispatch({ type: "epoch", epoch });
  const selectedIncident = epoch === selection.epoch ? selection.incident : undefined;
  const setSelectedIncident = useCallback((value: string) => dispatch({ type: "incident", value }), []);
  const focusedScenario = validFocus(selection.focus, epoch ?? -1);
  useEffect(() => {
    setFocusedCorrelation(focusedScenario?.correlationId ?? null);
  }, [focusedScenario?.correlationId, setFocusedCorrelation]);
  const clearScenarioFocus = useCallback(() => {
    setFocusedCorrelation(null);
    dispatch({ type: "clear" });
  }, [setFocusedCorrelation]);
  const beginScenarioFocus = useCallback(() => {
    const token = Symbol("operator focus intent"); dispatch({ type: "begin", token });
    return (attack: Attack) => {
      if (epoch !== undefined && epoch === live.data?.epoch) {
        setFocusedCorrelation(attack.correlation_id);
        dispatch({ type: "commit", token, focus: scenarioFocus(attack, epoch) });
      }
    };
  }, [epoch, live.data?.epoch, setFocusedCorrelation]);
  const focusScenario = useCallback((attack: Attack) => beginScenarioFocus()(attack), [beginScenarioFocus]);
  const value = useMemo(() => live.data ? ({
    data: live.data,
    telemetry: live.telemetry,
    connection: live.connection,
    refreshing: live.refreshing,
    refresh: live.refresh,
    selectedIncident,
    setSelectedIncident,
    focusedScenario, focusScenario, clearScenarioFocus, beginScenarioFocus,
  }) : null, [live.data, live.telemetry, live.connection, live.refreshing, live.refresh, selectedIncident, setSelectedIncident, focusedScenario, focusScenario, clearScenarioFocus, beginScenarioFocus]);

  if (live.loading && !live.data) return <LoadingScreen />;
  if (!live.data || !value) return <ErrorScreen message={live.error ?? "The SOC could not establish a backend connection."} retry={() => void live.refresh()} />;

  return <LiveRuntimeContext.Provider value={value}>
    <main className="soc-shell">
      <SystemHeader data={live.data} connection={live.connection} refreshing={live.refreshing} />
      {live.error && <div className="stale-banner">Live refresh failed: {live.error}. Showing the last verified snapshot.</div>}
      <SimulationControls state={live.data.simulation.state} systemActive={live.data.runtimeStatus.active} onComplete={live.refresh} onReset={clearScenarioFocus} />
      <div className="application-layout">
        <AppNavigation connection={live.connection} />
        <div className="page-workspace"><ScenarioContextBar data={live.data} focus={focusedScenario} onFocus={focusScenario} onClear={clearScenarioFocus} resynchronizing={epoch !== live.data.epoch} />{children}</div>
      </div>
      <footer className="app-footer"><span>FarmFlow Virtual SOC</span><span>QML inference: simulator-backed · No real attack or physical device controls</span><span>API {live.data.health.version}</span></footer>
    </main>
  </LiveRuntimeContext.Provider>;
}

export function useLiveRuntime() {
  const context = useContext(LiveRuntimeContext);
  if (!context) throw new Error("useLiveRuntime must be used inside LiveRuntimeProvider");
  return context;
}
