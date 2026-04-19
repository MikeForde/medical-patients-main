# Clinical Coherence Issues

This note documents why the generated patient records can be clinically incoherent, both:

- without the medical simulation bridge
- with the medical simulation bridge enabled

The focus here is not whether the code runs, but whether the generated record preserves a believable relationship between:

- injury or illness
- triage category
- treatments given
- evacuation path
- final status

## Executive Summary

The generator is not using one single clinically consistent model.

Instead, different parts of a patient record come from different layers:

- base patient creation in `patient_generator/flow_simulator.py`
- later condition and triage assignment in `src/domain/services/patient_generation_service.py`
- treatment selection in `patient_generator/flow_simulator.py` or `patient_generator/medical_simulation_bridge.py`
- routing in Markov or bridge logic
- final JSON shaping in `patient_generator/patient.py`

Because these layers are only loosely coupled, a generated patient can easily end up with:

- a disease diagnosis but trauma treatments
- a top-level `triage_category` that disagrees with the timeline
- a bullet wound on a leg but a chest intervention
- a healthy patient left at `Role4` instead of being discharged

## 1. Issues Without Medical Bridge

This section describes the standard path when `PatientFlowSimulator._simulate_patient_flow_single()` does not successfully use the medical bridge and instead uses the built-in Markov or sequential flow.

## 1.1 Later pipeline stages overwrite earlier clinical meaning

Base patients are created in `patient_generator/flow_simulator.py:349-445` and temporal patients in `patient_generator/flow_simulator.py:1159-1234`.

At that stage, the simulator already assigns things such as:

- `injury_type`
- `triage_category`
- `body_part`
- timeline start
- initial treatment/timeline state

Later, the async pipeline rewrites core clinical fields in `src/domain/services/patient_generation_service.py:204-239`:

- `patient.injury_type` is reassigned
- `patient.triage_category` is reassigned
- `patient.primary_condition` is assigned after that

That means the patient's final top-level diagnosis and triage can be different from the values that originally drove routing and timeline generation.

Practical result:

- the timeline may reflect one triage level
- the final JSON top-level `triage_category` may show another
- the condition shown to the user may not be the condition that influenced movement

## 1.2 Injury distribution selection appears dimensionally wrong

In `src/domain/services/patient_generation_service.py:206-216`, condition type is chosen using:

```python
rand_val = patient.id % 100
if rand_val < injury_dist.get("Disease", 0):
```

But the default injury mix is stored as fractions such as:

- `Disease: 0.52`
- `Non-Battle Injury: 0.33`
- `Battle Injury: 0.15`

So an integer from `0..99` is being compared directly against values in `0..1`.

This makes the reassignment highly sensitive to patient id and not semantically tied to the configured probabilities in the expected way.

Practical result:

- `id = 0` is very likely to become `DISEASE`
- `id = 1` is very likely to fall through to `BATTLE_TRAUMA`
- the patient's displayed condition type can be an artifact of id rather than of the earlier scenario generation

## 1.3 Routing is driven mainly by triage, not diagnosis

In the standard Markov path, routing is done in `patient_generator/facility_markov_chain.py:91-149`.

The main driver is:

- current facility
- `triage_category`
- a short list of special condition keywords

Only a few special conditions alter routing materially, such as:

- amputation
- burn
- TBI
- psychological stress

Most diagnoses do not directly influence routing.

Practical result:

- once a patient has a triage category, the evacuation path is mostly a triage problem, not a diagnosis problem
- a bullet wound can still be routed like a generic T3 patient
- a disease patient can still move through the same evacuation chain as a trauma casualty if the triage supports it

## 1.4 Treatment selection depends on exact SNOMED coverage; otherwise it becomes generic

Standard treatment generation is in `patient_generator/flow_simulator.py:853-937`.

If the treatment utility model has an exact SNOMED protocol entry, it can be diagnosis-specific.

If not, it falls back to generic facility capability lists in `patient_generator/treatment_protocols.json:243-270` or to simpler fallback logic.

Example:

- `62315008` Diarrhea has an explicit protocol in `patient_generator/treatment_protocols.json:163-180`
- `25374005` Gastroenteritis is listed as a disease code in `patient_generator/treatment_protocols.json:18-21`, but there is no specific treatment matrix entry for it

When no exact matrix entry exists, `TreatmentUtilityModel.select_treatments()` in `patient_generator/treatment_utility_model.py:280-341` falls back to all treatments available at the facility.

Practical result:

- disease cases without exact protocol coverage can receive generic trauma-flavored facility treatments
- this explains examples like gastroenteritis receiving `pressure_dressing` or `splint`

## 1.5 Body part is weakly coupled to treatment choice

The simulator assigns a body part in `patient_generator/flow_simulator.py:447-478`, but standard treatment generation in `patient_generator/flow_simulator.py:853-937` does not meaningfully constrain treatment by body part.

The selected treatment set is based mostly on:

- SNOMED code if available
- facility
- triage-derived severity

There is no strong check that a thoracic intervention matches a thoracic wound, or that a limb wound avoids chest-specific treatment.

Practical result:

- a leg bullet wound can still receive `chest_seal` if the chosen protocol for that SNOMED/facility includes it

## 1.6 Temporal generation and later condition assignment are not the same clinical model

Temporal patients are created in `patient_generator/flow_simulator.py:1159-1234`.

That code can assign:

- warfare-driven injury codes
- warfare-driven severity
- warfare-driven triage
- temporal metadata like scenario and event id

Later, the pipeline in `src/domain/services/patient_generation_service.py:204-239` assigns a new condition and a new top-level triage category.

Practical result:

- `movement_timeline` and `scenario` may reflect one causal model
- `conditions` and top-level `triage_category` may reflect a later, separate causal model

This is one of the clearest causes of apparent incoherence in the non-bridge path.

## 1.7 JSON serialization preserves mixed provenance rather than reconciling it

`patient_generator/patient.py:272-463` assembles the final JSON.

It does not reconcile contradictory sources. It simply serializes the latest values it sees for:

- `injury_type`
- `triage_category`
- `conditions`
- `treatments`
- `movement_timeline`

Practical result:

- if those fields were created by different layers with different assumptions, the JSON faithfully exposes the inconsistency rather than resolving it

## 2. Issues With Medical Bridge Enabled

When the bridge is enabled and succeeds, the path goes through `patient_generator/medical_simulation_bridge.py` via `patient_generator/flow_simulator.py:480-509`.

This path changes the shape of the output, but it does not eliminate incoherence. In several cases it makes it more obvious.

## 2.1 The bridge uses `injury_type` labels instead of the actual condition code as its main input

In `patient_generator/medical_simulation_bridge.py:238-245` and `329-336`, the bridge selects treatments using:

- `original_patient.injury`
- or `original_patient.injury_type`

In many generated records this value is a broad label such as:

- `DISEASE`
- `BATTLE_TRAUMA`

not the actual SNOMED-coded condition shown in the final JSON.

Practical result:

- the bridge can display one diagnosis to the user while internally treating the patient using only the coarse injury category string

## 2.2 Unknown injury labels default to a war injury SNOMED code

`patient_generator/medical_simulation_bridge.py:729-759` maps injury descriptions to SNOMED.

If the injury string is not recognized, it defaults to:

- `125670008` = general war injury

That means broad labels like `DISEASE` can fall through to a battle trauma code.

Practical result:

- conjunctivitis or another disease case can be internally treated as a generic war injury
- trauma-style interventions can appear on disease records

## 2.3 The bridge does not pass the true condition into the medical simulation engine

`medical_simulation/patient_flow_orchestrator.py:134-143` accepts a `true_condition_code`.

But `patient_generator/medical_simulation_bridge.py:91-98` does not pass the patient's actual condition code into `initialize_patient()`.

Practical result:

- the richer simulation engine is not anchored to the actual generated diagnosis
- optional diagnostic uncertainty features cannot operate from the real underlying condition

## 2.4 The bridge can re-triage internally while the final JSON preserves the original triage

In the orchestrator, `process_triage()` recalculates triage from current health in `medical_simulation/patient_flow_orchestrator.py:328-369`.

But when bridge results are copied back, `patient_generator/medical_simulation_bridge.py:928-929` explicitly preserves the original patient triage instead of updating it from the simulation.

Practical result:

- the internal bridge simulation may be operating on one triage state
- the final JSON may still display the earlier triage state

This creates another avenue for disagreement between displayed triage and actual movement decisions.

## 2.5 Duplicate-treatment prevention is broken by mismatched simulation IDs

The bridge creates the simulation patient ID as:

- `str(patient.id)` in `patient_generator/medical_simulation_bridge.py:77-79`

But duplicate-treatment lookup uses:

- `f"sim_{patient.id}"` in `patient_generator/medical_simulation_bridge.py:527-529`

These ids do not match.

Practical result:

- previously applied treatments are not found
- deduplication silently fails
- the same treatment bundle can be applied repeatedly

This matches records that show the same small set of treatments repeated many times.

## 2.6 All treatments are labeled with the patient's final location

When bridge results are copied back, `patient_generator/medical_simulation_bridge.py:931-940` writes treatment history using:

- `location: sim_patient.current_location`

at the time of serialization

not the location where each treatment was originally applied.

Practical result:

- if the patient ends at `Role4`, every treatment can appear to have been given at `Role4`
- POI and Role1 treatments lose their true provenance

## 2.7 The bridge timeline is reconstructed, not preserved from actual simulation timestamps

The bridge does not directly expose the simulation timestamps as-is. In `patient_generator/medical_simulation_bridge.py:853-911`, it rebuilds a viewer-friendly timeline using:

- triage-based spacing rules
- per-patient deterministic jitter
- synthetic monotonic `hours_since_injury`

Practical result:

- timeline spacing is partially fabricated for viewer smoothness
- event timing may look orderly but not actually correspond to simulated care durations
- the displayed timeline is closer to a normalized visualization than a literal medical simulation trace

## 2.8 Role4 discharge logic is partially unreachable

In `patient_generator/medical_simulation_bridge.py:404-411`, the bridge breaks immediately if `current_facility == "Role4"`.

Later in the same loop, explicit discharge logic exists at `patient_generator/medical_simulation_bridge.py:498-502`:

- if at `Role4` and `current_health >= 90`, discharge RTD

But that later block is bypassed if the earlier `break` has already executed.

Practical result:

- a patient can reach `Role4`
- have `health` at or near `100`
- but still serialize as remaining in the system instead of being discharged

This explains records with combinations like:

- `health: 100`
- `status: Role4`
- `final_status: Remains_Role4`

## 2.9 Bridge fallback treatment logic is clinically generic

If protocol-based treatment selection and utility-based selection do not yield an answer, the bridge falls back in `patient_generator/medical_simulation_bridge.py:604-646` to keyword matching such as:

- `gunshot`
- `blast`
- `burn`
- `shrapnel`

and finally to a default `pressure_bandage`.

Practical result:

- non-trauma diagnoses can still drift into generic trauma care if the bridge cannot map them correctly

## 3. Issues Shared By Both Paths

## 3.1 Diagnosis, triage, treatment, and routing are not produced by one causal model

Across both modes, these fields can be produced by different subsystems with different assumptions:

- diagnosis from `MedicalConditionGenerator`
- triage from base generation, later overwrite, or bridge re-triage
- routing from Markov probabilities or bridge health thresholds
- treatment from utility lookup, protocol lookup, or fallback logic

Practical result:

- the output can be internally inconsistent even when each subsystem individually behaves as coded

## 3.2 Broad category labels are overloaded

Terms such as:

- `DISEASE`
- `BATTLE_TRAUMA`
- `Battle Injury`

are used as if they are both:

- epidemiologic categories
- diagnosis proxies
- routing inputs
- treatment inputs

They are too coarse for those jobs.

Practical result:

- a broad category is often forced to stand in for a specific clinical condition, which leads to implausible care plans

## 3.3 The final JSON is optimized for output, not for clinical reconciliation

`patient_generator/patient.py:320-463` is good at compact serialization, but it does not attempt to reconcile contradictions between:

- displayed condition
- recorded timeline
- treatment history
- derived final status

Practical result:

- clinically incoherent combinations are preserved into `patients.json` rather than filtered or normalized

## 4. Interpreting Example Failures

The observed examples are therefore not random anomalies. They are expected consequences of the current architecture.

### Example pattern A

- disease diagnosis
- trauma dressing or splint

Likely cause:

- exact disease protocol missing or bypassed
- generic facility treatment fallback used instead

### Example pattern B

- bullet wound
- T3-style movement
- RTD from Role1

Likely cause:

- routing driven mainly by triage probabilities
- body region not constraining treatment
- top-level triage possibly overwritten after earlier routing

### Example pattern C

- conjunctivitis
- tourniquet / airway positioning / pressure bandage
- all treatments shown at `Role4`

Likely cause:

- bridge maps broad label to default war-injury SNOMED
- treatment dedupe fails
- treatment provenance overwritten with final location

### Example pattern D

- `health: 100`
- `status: Role4`
- `final_status: Remains_Role4`

Likely cause:

- bridge reaches Role4
- discharge block is bypassed by earlier loop break

## 5. Bottom Line

The core clinical coherence problem is not a single bad rule. It is that the generator composes the final patient record from multiple partially independent layers.

Without the bridge, the main problems are:

- later overwriting of diagnosis and triage
- routing mostly detached from diagnosis
- treatment fallback to generic facility capabilities

With the bridge, the main problems are:

- coarse injury labels standing in for diagnosis
- defaulting unknown labels to war injury
- broken treatment deduplication
- incorrect treatment provenance
- partially unreachable discharge logic

In both modes, the final JSON can therefore be structurally valid while clinically incoherent.
