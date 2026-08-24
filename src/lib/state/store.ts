import { create } from 'zustand';
import type {
  WorkflowPlan,
  ExecutionTrace,
  ExecutionMode,
  FaultInjection,
  FieldMapping,
  ServiceId,
} from '@/types';

export type InspectorTab = 'endpoint' | 'headers' | 'request' | 'response';

export interface EnvStatus {
  allowLive: boolean;
  services: Record<ServiceId, { ready: boolean; missing: string[] }>;
}

interface IntegrelliState {
  // core data
  plan: WorkflowPlan | null;
  trace: ExecutionTrace | null;
  seed: string;
  mode: ExecutionMode;
  faults: FaultInjection[];

  // selection / UI
  expandedStepId: string | null;
  activeTab: InspectorTab;
  editingMapping: { stepId: string; index: number } | null;

  // async status
  isGenerating: boolean;
  planError: string | null;
  isRunning: boolean;
  executeError: string | null;

  envStatus: EnvStatus | null;

  // actions
  setPlan: (plan: WorkflowPlan | null) => void;
  updateMapping: (stepId: string, index: number, mapping: FieldMapping) => void;
  setTrace: (trace: ExecutionTrace | null) => void;
  setSeed: (seed: string) => void;
  setMode: (mode: ExecutionMode) => void;
  setFault: (stepId: string, fault: Omit<FaultInjection, 'stepId'> | null) => void;
  setExpandedStep: (stepId: string | null) => void;
  setActiveTab: (tab: InspectorTab) => void;
  setEditingMapping: (target: { stepId: string; index: number } | null) => void;
  setGenerating: (value: boolean) => void;
  setPlanError: (error: string | null) => void;
  setRunning: (value: boolean) => void;
  setExecuteError: (error: string | null) => void;
  setEnvStatus: (status: EnvStatus | null) => void;
  reset: () => void;
}

const initialState = {
  plan: null,
  trace: null,
  seed: 'integrelli',
  mode: 'test' as ExecutionMode,
  faults: [] as FaultInjection[],
  expandedStepId: null,
  activeTab: 'endpoint' as InspectorTab,
  editingMapping: null,
  isGenerating: false,
  planError: null,
  isRunning: false,
  executeError: null,
  envStatus: null,
};

export const useIntegrelliStore = create<IntegrelliState>((set) => ({
  ...initialState,

  setPlan: (plan) =>
    set({ plan, trace: null, expandedStepId: null, editingMapping: null, executeError: null }),

  updateMapping: (stepId, index, mapping) =>
    set((state) => {
      if (!state.plan) return state;
      const steps = state.plan.steps.map((step) => {
        if (step.id !== stepId) return step;
        const mappings = step.mappings.slice();
        mappings[index] = mapping;
        return { ...step, mappings };
      });
      return { plan: { ...state.plan, steps } };
    }),

  setTrace: (trace) => set({ trace }),
  setSeed: (seed) => set({ seed }),
  setMode: (mode) => set({ mode }),

  setFault: (stepId, fault) =>
    set((state) => {
      const rest = state.faults.filter((f) => f.stepId !== stepId);
      if (fault === null) return { faults: rest };
      return { faults: [...rest, { stepId, ...fault }] };
    }),

  setExpandedStep: (expandedStepId) => set({ expandedStepId }),
  setActiveTab: (activeTab) => set({ activeTab }),
  setEditingMapping: (editingMapping) => set({ editingMapping }),
  setGenerating: (isGenerating) => set({ isGenerating }),
  setPlanError: (planError) => set({ planError }),
  setRunning: (isRunning) => set({ isRunning }),
  setExecuteError: (executeError) => set({ executeError }),
  setEnvStatus: (envStatus) => set({ envStatus }),
  reset: () => set(initialState),
}));
