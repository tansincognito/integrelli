'use client';

import type { EndpointSpec, WorkflowStep, TriggerSpec, JsonValue, FieldMapping } from '@/types';
import { setByPath } from '@/lib/utils/json-path';
import { JsonViewer } from '@/components/ui/JsonViewer';
import { ProvenanceBadge } from '@/components/ui/Badge';
import { MappingEditor } from './MappingEditor';
import { useIntegrelliStore } from '@/lib/state/store';

function previewValue(mapping: FieldMapping): JsonValue {
  switch (mapping.source.kind) {
    case 'literal':
      return mapping.source.value;
    case 'secret':
      return `<${mapping.source.envVar}>`;
    case 'ref':
      return mapping.source.expression;
    case 'unresolved':
      return null;
  }
}

export function RequestTab({
  step,
  trigger,
  priorSteps,
}: {
  endpoint: EndpointSpec;
  step: WorkflowStep;
  trigger: TriggerSpec;
  priorSteps: WorkflowStep[];
}) {
  const editingMapping = useIntegrelliStore((s) => s.editingMapping);
  const setEditingMapping = useIntegrelliStore((s) => s.setEditingMapping);
  const updateMapping = useIntegrelliStore((s) => s.updateMapping);

  const bodyMappings = step.mappings
    .map((mapping, index) => ({ mapping, index }))
    .filter(({ mapping }) => mapping.target === 'body');

  if (bodyMappings.length === 0) {
    return <p className="text-xs text-muted">This step has no request body fields mapped.</p>;
  }

  let body: JsonValue = {};
  const pathToIndex = new Map<string, number>();
  for (const { mapping, index } of bodyMappings) {
    body = setByPath(body, mapping.path, previewValue(mapping));
    pathToIndex.set(mapping.path, index);
  }

  const activeIndex = editingMapping?.stepId === step.id ? editingMapping.index : null;

  return (
    <div className="space-y-3">
      <JsonViewer
        value={body}
        annotate={(path) => {
          const index = pathToIndex.get(path);
          if (index === undefined) return null;
          const mapping = step.mappings[index];
          return (
            <button
              type="button"
              onClick={() => setEditingMapping({ stepId: step.id, index })}
              className="ml-1 align-middle"
            >
              <ProvenanceBadge kind={mapping.source.kind} required={mapping.required} />
            </button>
          );
        }}
      />
      {activeIndex !== null && (
        <MappingEditor
          key={`${step.id}-${activeIndex}`}
          mapping={step.mappings[activeIndex]}
          trigger={trigger}
          priorSteps={priorSteps}
          onSave={(next) => {
            updateMapping(step.id, activeIndex, next);
            setEditingMapping(null);
          }}
          onCancel={() => setEditingMapping(null)}
        />
      )}
    </div>
  );
}
