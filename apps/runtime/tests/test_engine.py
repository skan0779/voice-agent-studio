from __future__ import annotations

import unittest

from voice_agent_runtime.bindings import BindingResolver
from voice_agent_runtime.engine import FlowEngine
from voice_agent_runtime.models import DeploymentBundle


def bundle() -> DeploymentBundle:
    return DeploymentBundle(
        workspace_id="workspace-test",
        flow_spec={
            "schema_version": "2.0",
            "id": "agent-test",
            "name": "Test Agent",
            "version": 1,
            "status": "published",
            "entry_node_id": "start-1",
            "start": {"session_update": {"instructions": "Base"}},
            "nodes": [
                {"id": "start-1", "type": "start"},
                {
                    "id": "consent-1",
                    "type": "node",
                    "instructions": "Consent is @state.consent.status",
                    "tool_ids": ["tool-consent"],
                    "tool_input_bindings": [],
                    "tool_function_bindings": [
                        {
                            "tool_id": "tool-consent",
                            "function_id": "function-consent",
                            "input_mapping": {"decision": "@tool.arguments.decision"},
                        }
                    ],
                    "runtime": {
                        "tool_choice": "required",
                        "output_modalities": ["text"],
                        "parallel_tool_calls": False,
                        "follow_up_audio": True,
                    },
                },
                {"id": "end-1", "type": "end", "end": {"final_message": "Bye"}},
            ],
            "edges": [
                {"id": "e1", "source": "start-1", "target": "consent-1", "route_type": "always", "priority": 1},
                {
                    "id": "e2",
                    "source": "consent-1",
                    "target": "end-1",
                    "route_type": "condition",
                    "priority": 1,
                    "condition": {
                        "logic": "all",
                        "rules": [
                            {
                                "kind": "state",
                                "path": "@state.consent.status",
                                "comparator": "equals",
                                "value": "granted",
                            }
                        ],
                    },
                },
            ],
        },
        tools=[
            {
                "id": "tool-consent",
                "name": "record_consent",
                "description": "Record consent",
                "parameters": [
                    {
                        "name": "decision",
                        "type": "string",
                        "required": True,
                        "enumValues": ["granted", "declined"],
                    }
                ],
            }
        ],
        functions=[
            {
                "id": "function-consent",
                "inputs": [{"name": "decision", "required": True}],
                "actions": [
                    {
                        "type": "state",
                        "updates": [
                            {
                                "target": "@state.consent.status",
                                "method": "replace",
                                "value": "@inputs.decision",
                            }
                        ],
                    }
                ],
            }
        ],
        state_schema={
            "id": "state-test",
            "groups": [
                {
                    "key": "consent",
                    "fields": [{"key": "status", "defaultValue": "pending"}],
                }
            ],
        },
        data_assets=[],
    )


class BindingResolverTests(unittest.TestCase):
    def test_resolves_typed_and_interpolated_values(self):
        resolver = BindingResolver(
            state={"screening": {"index": 2}},
            inputs={"label": "매일"},
            tool_arguments={},
            outputs={},
            data_assets=[],
        )
        self.assertEqual(resolver.resolve("@state.screening.index"), 2)
        self.assertEqual(resolver.resolve("답변: @inputs.label"), "답변: 매일")

    def test_resolves_nested_state_indexes_and_array_projections(self):
        resolver = BindingResolver(
            state={"phq_9": {"current_item_index": 1}},
            inputs={},
            tool_arguments={},
            outputs={},
            data_assets=[
                {
                    "id": "phq-2",
                    "name": "PHQ-2",
                    "content": """{
                        "items": [
                            {"prompt": "첫 번째", "response_set": "frequency"},
                            {"prompt": "두 번째", "response_set": "frequency"}
                        ],
                        "response_sets": {
                            "frequency": [
                                {"id": "never", "label": "전혀 아니다"},
                                {"id": "often", "label": "자주 그렇다"}
                            ]
                        }
                    }""",
                }
            ],
        )

        self.assertEqual(
            resolver.resolve("@PHQ-2.items[@state.phq_9.current_item_index].prompt"),
            "두 번째",
        )
        self.assertEqual(
            resolver.resolve("@PHQ-2.response_sets[@PHQ-2.items[@state.phq_9.current_item_index].response_set][].id"),
            ["never", "often"],
        )
        self.assertIn(
            '"label": "전혀 아니다"',
            resolver.resolve(
                "선택지: @PHQ-2.response_sets[@PHQ-2.items[@state.phq_9.current_item_index].response_set] 입니다."
            ),
        )


class FlowEngineTests(unittest.TestCase):
    def test_tool_function_updates_state_then_routes(self):
        engine = FlowEngine(bundle())
        engine.enter_first_node()
        self.assertEqual(engine.current_node_id, "consent-1")
        self.assertIn("pending", engine.render_instructions())

        result = engine.execute_tool("record_consent", {"decision": "granted"})

        self.assertTrue(result["ok"])
        self.assertEqual(engine.state["consent"]["status"], "granted")
        self.assertEqual(engine.current_node_id, "end-1")

    def test_omitted_optional_tool_argument_does_not_block_function_execution(self):
        runtime_bundle = bundle()
        runtime_bundle.tools[0]["parameters"].append(
            {
                "name": "candidate_response_ids",
                "type": "array",
                "itemType": "string",
                "required": False,
            }
        )
        runtime_bundle.functions[0]["inputs"].append({"name": "candidate_response_ids", "required": False})
        runtime_bundle.flow_spec["nodes"][1]["tool_function_bindings"][0]["input_mapping"]["candidate_response_ids"] = (
            "@tool.arguments.candidate_response_ids"
        )
        engine = FlowEngine(runtime_bundle)
        engine.enter_first_node()

        result = engine.execute_tool("record_consent", {"decision": "granted"})

        self.assertTrue(result["ok"])
        self.assertEqual(engine.state["consent"]["status"], "granted")
        self.assertEqual(engine.current_node_id, "end-1")

    def test_builds_realtime_tool_schema(self):
        engine = FlowEngine(bundle())
        engine.enter_first_node()

        tool = engine.realtime_tools()[0]

        self.assertEqual(tool["name"], "record_consent")
        self.assertEqual(tool["parameters"]["properties"]["decision"]["enum"], ["granted", "declined"])

    def test_builds_runtime_input_bound_enum_without_duplicating_the_input_path(self):
        runtime_bundle = bundle()
        runtime_bundle.flow_spec["nodes"][1]["tool_input_bindings"] = [
            {
                "tool_id": "tool-consent",
                "input_mapping": {
                    "response_options": "@state.screening.response_options",
                    "response_option_details": "@state.screening.response_option_details",
                },
            }
        ]
        runtime_bundle.state_schema["groups"].append(
            {
                "key": "screening",
                "fields": [
                    {
                        "key": "response_options",
                        "defaultValue": ["not_at_all", "several_days"],
                    },
                    {
                        "key": "response_option_details",
                        "defaultValue": [
                            {"id": "not_at_all", "label": "전혀 아니다", "score": 0},
                            {"id": "several_days", "label": "며칠 동안", "score": 1},
                        ],
                    },
                ],
            }
        )
        runtime_bundle.tools[0]["parameters"][0]["enumValues"] = [
            {
                "kind": "input",
                "inputKey": "response_options",
                "path": "response_options",
            }
        ]
        runtime_bundle.tools[0]["parameters"][0]["description"] = "Current mapping: @inputs.response_option_details"
        engine = FlowEngine(runtime_bundle)
        engine.enter_first_node()

        tool = engine.realtime_tools()[0]

        self.assertEqual(
            tool["parameters"]["properties"]["decision"]["enum"],
            ["not_at_all", "several_days"],
        )
        self.assertIn(
            '"label": "전혀 아니다"',
            tool["parameters"]["properties"]["decision"]["description"],
        )

    def test_code_output_can_update_a_dynamic_state_target(self):
        runtime_bundle = bundle()
        runtime_bundle.flow_spec["nodes"][1]["tool_function_bindings"][0]["input_mapping"] = {
            "assessment_key": "phq_9",
            "value": "@tool.arguments.decision",
        }
        runtime_bundle.functions[0]["inputs"] = [
            {"name": "assessment_key", "required": True},
            {"name": "value", "required": True},
        ]
        runtime_bundle.functions[0]["actions"] = [
            {
                "type": "code",
                "resultKey": "evaluation",
                "code": 'return {"answer": inputs["value"]}',
            },
            {
                "type": "state",
                "updates": [
                    {
                        "target": "@state[@inputs.assessment_key].answer",
                        "method": "replace",
                        "value": "@output.evaluation.answer",
                    }
                ],
            },
        ]
        runtime_bundle.state_schema["groups"].append(
            {"key": "phq_9", "fields": [{"key": "answer", "defaultValue": ""}]}
        )
        engine = FlowEngine(runtime_bundle, allow_unsafe_code_actions=True)
        engine.enter_first_node()

        engine.execute_tool("record_consent", {"decision": "매일"})

        self.assertEqual(engine.state["phq_9"]["answer"], "매일")


if __name__ == "__main__":
    unittest.main()
