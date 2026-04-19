# Generate Flow

This documents the flow from pressing the frontend Generate button through to the construction of `patients.json` and `patients.csv`.

## Short Answer

The frontend initiates generation, but the main generation logic lives in:

- `src/domain/services/patient_generation_service.py`
- `patient_generator/flow_simulator.py`
- `patient_generator/patient.py`

That is where patients are created, given injuries/triage/demographics, pushed through treatment-flow simulation, converted to dictionaries, and streamed into the final output files.

## 1. Frontend Button Click

The button binding is in `static/js/app.js:115-119`:

- `bindEvents()` adds a click listener to `generateBtn`
- the listener calls `this.handleGenerate()`

The main frontend entrypoint is `static/js/app.js:529-583` in `handleGenerate()`.

What it does:

1. Validates the accordion state.
2. Builds a unified config with `buildConfiguration()`.
3. Stores some UI state for progress display.
4. Calls:

```js
const response = await this.apiClient.generatePatients({
    configuration,
    output_formats: ['json', 'csv']
});
```

Key point: the frontend always requests both JSON and CSV here.

The config object itself is assembled in `static/js/app.js:585-662` and includes things such as:

- `total_patients`
- `days_of_fighting`
- `base_date`
- `injury_mix`
- `warfare_types`
- `front_configs`
- `facility_configs`
- `medical_simulation`
- `advanced_overrides`

## 2. Frontend API Client

`static/js/services/api.js:91-93`:

```js
async generatePatients(configuration) {
    return this.post('/generation/', configuration);
}
```

That flows into `request()` in `static/js/services/api.js:24-70`, which:

- prefixes the URL with `/api/v1`
- JSON-serializes the body
- sends the POST using `fetch()`

So the actual request sent by the browser is to:

- `/api/v1/generation/`

## 3. FastAPI Generation Endpoint

Backend entrypoint: `src/api/v1/routers/generation.py:74-127`

`generate_patients()` accepts a `GenerationRequest` (`src/api/v1/models/requests.py:11-103`), validates it, then:

1. Pulls the inline config from `request.configuration`.
2. Merges in generation options such as:
   - `output_formats`
   - `use_compression`
   - `use_encryption`
   - `priority`
3. Creates a job via `job_service.create_job(...)`.
4. Schedules `_run_generation_task(...)` as a FastAPI background task.
5. Immediately returns a `job_id` to the frontend.

So this endpoint does not generate patients directly. It creates and launches the job.

## 4. Background Job Runner

The job body is in `src/api/v1/routers/generation.py:171-350`.

This is the bridge between the API layer and the actual generator.

### 4.1 Output directory

The runner creates a temp output directory:

- `tempfile.gettempdir()/medical_patients/job_{job_id}`

from `src/api/v1/routers/generation.py:190-192`.

### 4.2 Temporal config handoff

If the incoming config contains temporal keys like `warfare_types`, `special_events`, `environmental_conditions`, or `base_date`, `_run_generation_task()` rewrites `patient_generator/injuries.json` temporarily (`src/api/v1/routers/generation.py:202-255`).

That matters because `PatientFlowSimulator.generate_casualty_flow()` later reads `patient_generator/injuries.json` to decide whether to use temporal generation.

### 4.3 Config persistence

If the request used inline config instead of a saved config ID, the runner creates a temporary configuration record in the database (`src/api/v1/routers/generation.py:270-287`).

It then builds a `GenerationContext` (`src/api/v1/routers/generation.py:300-308`) with:

- the configuration template
- job id
- output directory
- output formats
- compression/encryption settings

Finally it calls:

```python
result = await generation_service.generate_patients(generation_context, progress_callback)
```

This is the real handoff into generation.

## 5. Where the Main Generation Happens

The main service entrypoint is:

- `src/domain/services/patient_generation_service.py:280-395`

This is the best single place to start reading if you want the true generation pipeline.

### 5.1 Pipeline initialization

`AsyncPatientGenerationService._initialize_pipeline()` (`src/domain/services/patient_generation_service.py:257-278`) creates:

- `ConfigurationManager`
- `PatientFlowSimulator`
- `DemographicsGenerator`
- `MedicalConditionGenerator`
- `OutputFormatter`

This wires the generator together.

### 5.2 Streaming generation loop

The actual per-patient pipeline is in `PatientGenerationPipeline.generate()` (`src/domain/services/patient_generation_service.py:71-109`).

For each patient it does:

1. `_generate_base_patients(context)`
2. `_add_medical_conditions(patient, context)`
3. `self.flow_simulator._simulate_patient_flow_single(patient)`
4. `_add_demographics(patient, context)`
5. `patient.to_dict()`
6. yield both the `Patient` object and the JSON-ready dictionary

Important note: `_generate_base_patients()` calls `flow_simulator.generate_casualty_flow()` (`src/domain/services/patient_generation_service.py:145-156`), and that method already performs major patient creation and flow simulation. The pipeline then invokes `_simulate_patient_flow_single()` again after medical conditions are added. So the flow logic is concentrated in `PatientFlowSimulator`, even though it is entered more than once.

## 6. The Core Simulation Logic

The heaviest logic is in `patient_generator/flow_simulator.py`.

## 6.1 Generation mode selection

`PatientFlowSimulator.generate_casualty_flow()` is at `patient_generator/flow_simulator.py:284-311`.

It reads `patient_generator/injuries.json` and decides between:

- temporal generation: `generate_temporal_casualties()`
- legacy generation: sequential or parallel patient creation

### Temporal path

`generate_temporal_casualties()` is in `patient_generator/flow_simulator.py:1053-1101`.

It:

1. loads `injuries.json`
2. creates a `TemporalPatternGenerator`
3. generates a casualty timeline with `generate_timeline(...)`
4. converts timeline events into `Patient` objects with `_generate_patients_from_timeline(...)`
5. simulates each patient's medical movement flow

The timeline-to-patient conversion is in:

- `patient_generator/flow_simulator.py:1129-1157`
- `patient_generator/flow_simulator.py:1159-1234`

That is where a temporal casualty event becomes an actual `Patient` object with:

- injury timestamp
- warfare scenario metadata
- mass casualty flags
- injury type
- triage category
- body part
- front
- nationality

### Legacy path

The legacy patient creation path starts in:

- `patient_generator/flow_simulator.py:313-346`
- `patient_generator/flow_simulator.py:349-445`

`_create_initial_patient()` sets the base patient state:

- patient id
- initial injury timestamp
- front
- nationality
- gender
- day of injury
- injury type
- triage category
- body part
- initial POI treatment

## 6.2 Flow and timeline simulation

The detailed movement/treatment simulation is in:

- `patient_generator/flow_simulator.py:480-643`
- and the Markov variant starting at `patient_generator/flow_simulator.py:692`

This is one of the main places where the “meat” lives.

`_simulate_patient_flow_single(patient)` is responsible for building the patient journey through care. It:

- adds treatments at each facility
- adds arrival events to `movement_timeline`
- adds evacuation events
- adds transit events
- decides KIA / RTD / remain-in-system outcomes
- sets final status timestamps and location

This is where the patient timeline data that the viewer cares about is largely assembled.

## 7. Patient JSON Shape Construction

Once the pipeline has a populated `Patient`, it converts it to a dictionary using:

- `patient_generator/patient.py:272-463`

This is the code that constructs the JSON object for each patient.

`Patient.to_dict()` builds a cleaned, compact dictionary including fields such as:

- `id`
- `nationality`
- `gender`
- `injury_type`
- `triage_category`
- `status`
- `front`
- `final_status`
- `last_facility`
- `demographics`
- `health`
- `conditions`
- `treatments`
- `movement_timeline`
- `injury_time`
- `scenario`
- `event_id`
- `mass_casualty`
- `day`
- `body_part`

It also:

- derives `final_status` and `last_facility` from the timeline
- formats timestamps
- removes nulls and empty collections
- rounds numeric values where needed

If you want to know what one patient record in `patients.json` looks like, `Patient.to_dict()` is the key function.

## 8. How `patients.json` Is Written

The JSON file is written in `src/domain/services/patient_generation_service.py:303-381`.

The service opens a temp JSON file in the output directory and starts it with:

```python
temp_file.write("[\n")
```

Then for each generated patient:

1. it gets `patient_data` from `patient.to_dict()`
2. it writes commas between records as needed
3. it writes each record with `json.dump(patient_data, stream, separators=(",", ":"))`

After the loop it closes the array with:

```python
temp_file.write("\n]")
```

Then `_finalize_files()` (`src/domain/services/patient_generation_service.py:406-427`) renames the temp file to:

- `patients.json`

inside the job output directory.

So `patients.json` is a streamed JSON array of per-patient dictionaries.

## 9. How `patients.csv` Is Written

The CSV is also written in `src/domain/services/patient_generation_service.py:350-370`.

Unlike JSON, it is not built from `patient.to_dict()`. It is written manually from the live `Patient` object.

On the first row the code writes this header:

```csv
patient_id,name,age,gender,nationality,injury,triage,front,final_status,last_facility,total_timeline_events,injury_timestamp
```

Then for each patient it writes a row using:

- `patient.id`
- first/last name from `patient.demographics`
- age from `patient.get_age()`
- `patient.gender`
- `patient.nationality`
- `patient.injury_type`
- `patient.triage_category`
- `patient.front`
- `patient.final_status` or fallback
- `patient.last_facility` or `patient.current_status`
- `len(patient.movement_timeline)`
- `patient.injury_timestamp.isoformat()`

After generation, `_finalize_files()` renames that temp CSV file to:

- `patients.csv`

## 10. Job Completion and Download

After files are written, `_run_generation_task()` stores them on the job record via `job_service.set_job_results(...)` in `src/api/v1/routers/generation.py:341-347`.

The frontend then polls job status through:

- `static/js/app.js:727-750`
- `static/js/services/api.js:176-209`

Once complete, downloads come from:

- `src/api/v1/routers/downloads.py`

That endpoint either:

- returns a ZIP of the output directory
- or returns raw JSON via `?format=json`

## 11. Practical Answer: Where to Read First

If the goal is to understand where generation really happens, read these in order:

1. `static/js/app.js:529-583` for the frontend trigger
2. `src/api/v1/routers/generation.py:171-319` for the job handoff
3. `src/domain/services/patient_generation_service.py:280-381` for the generation/file-writing pipeline
4. `patient_generator/flow_simulator.py:284-311`, `1053-1101`, `480-643` for the actual patient and timeline simulation
5. `patient_generator/patient.py:272-463` for the final JSON object shape

## Bottom Line

The frontend and API mostly orchestrate.

The main generation “meat” is:

- `PatientFlowSimulator` for creating patients and simulating their movement/treatment timeline
- `Patient.to_dict()` for shaping the JSON record
- `AsyncPatientGenerationService.generate_patients()` for streaming those records into `patients.json` and `patients.csv`
