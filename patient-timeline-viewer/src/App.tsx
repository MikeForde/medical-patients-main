import { useState, useEffect, useMemo } from 'react';
import { AnimatePresence } from 'framer-motion';
import { Patient, PlaybackState, FacilityName, PatientLocation, TimelineEvent } from './types/patient.types';
import { FileUploader } from './components/FileUploader';
import { FacilityColumn } from './components/FacilityColumn';
import { TimelineControls } from './components/TimelineControls';
import { FilterBar, FilterState, filterPatients, initialFilterState } from './components/FilterBar';
import { loadPatientsFromData } from './utils/patientDataLoader';
import { getPatientLocationAtTime, getTimelineExtent } from './utils/timelineEngine';
import './index.css';

const FACILITIES: FacilityName[] = ['POI', 'Role1', 'Role2', 'Role3', 'Role4'];
type InspectorMode = 'details' | 'json';

const getPatientDisplayName = (patient: Patient) => {
  const firstName = patient.demographics?.given_name || patient.given_name || '';
  const lastName = patient.demographics?.family_name || patient.family_name || '';

  if (firstName && lastName) {
    return `${firstName} ${lastName}`;
  }

  return `Patient ${patient.id}`;
};

const getPatientConditionLabel = (patient: Patient) => {
  const conditionName = patient.primary_condition?.display
    || (patient as any).conditions?.[0]?.name
    || patient.injury_type;
  const bodyPart = (patient as any).body_part;

  if (!conditionName) {
    return 'Unknown';
  }

  return bodyPart ? `${conditionName} (${bodyPart})` : conditionName;
};

const formatTimestamp = (timestamp?: string) => {
  if (!timestamp) {
    return 'Unknown';
  }

  const parsed = new Date(timestamp);

  if (Number.isNaN(parsed.getTime())) {
    return timestamp;
  }

  return parsed.toLocaleString();
};

const formatLocationLabel = (location: PatientLocation | null) => {
  if (!location?.facility) {
    return 'Not yet on timeline';
  }

  return `${location.facility} (${location.status.toUpperCase()})`;
};

const formatEventType = (eventType: TimelineEvent['event_type']) => {
  switch (eventType) {
    case 'arrival':
      return 'Arrival';
    case 'evacuation_start':
      return 'Evacuation start';
    case 'transit_start':
      return 'Transit start';
    case 'kia':
      return 'KIA';
    case 'rtd':
      return 'RTD';
    case 'remains_role4':
      return 'Remains Role 4';
    default:
      return eventType;
  }
};

function App() {
  const [patients, setPatients] = useState<Patient[]>([]);
  const [isRemoteLoading, setIsRemoteLoading] = useState(false);
  const [remoteError, setRemoteError] = useState<string | null>(null);
  const [dataSourceLabel, setDataSourceLabel] = useState<string | null>(null);
  const [playbackState, setPlaybackState] = useState<PlaybackState>({
    isPlaying: false,
    currentTime: new Date('2024-01-01T00:00:00Z'),
    speed: 1,
    startTime: new Date('2024-01-01T00:00:00Z'),
    endTime: new Date('2024-01-01T24:00:00Z'),
    isLooping: false
  });
  const [filters, setFilters] = useState<FilterState>(initialFilterState);
  const [selectedPatient, setSelectedPatient] = useState<Patient | null>(null);
  const [inspectorMode, setInspectorMode] = useState<InspectorMode | null>(null);

  // Filter patients based on current filter state
  const filteredPatients = useMemo(() => {
    return filterPatients(patients, filters, playbackState.currentTime);
  }, [patients, filters, playbackState.currentTime]);

  // Update timeline extent when patients change
  useEffect(() => {
    if (patients.length > 0) {
      const extent = getTimelineExtent(patients);
      setPlaybackState(prev => ({
        ...prev,
        currentTime: extent.start,
        startTime: extent.start,
        endTime: extent.end
      }));
    }
  }, [patients]);

  useEffect(() => {
    setSelectedPatient(null);
    setInspectorMode(null);
  }, [patients]);

  useEffect(() => {
    const searchParams = new URLSearchParams(window.location.search);
    const jobId = searchParams.get('jobId');
    const apiBaseUrl = searchParams.get('apiBaseUrl');

    if (!jobId || !apiBaseUrl) {
      return;
    }

    let isCancelled = false;

    const loadRemotePatients = async () => {
      setIsRemoteLoading(true);
      setRemoteError(null);

      try {
        const normalizedBaseUrl = apiBaseUrl.replace(/\/$/, '');

        const configResponse = await fetch(`${normalizedBaseUrl}/api/v1/config/frontend`);
        if (!configResponse.ok) {
          throw new Error('Unable to load backend frontend configuration');
        }

        const frontendConfig = await configResponse.json();
        const resultsResponse = await fetch(
          `${normalizedBaseUrl}/api/v1/downloads/${encodeURIComponent(jobId)}?format=json`,
          {
            headers: {
              'X-API-Key': frontendConfig.apiKey
            }
          }
        );

        if (!resultsResponse.ok) {
          let detail = 'Failed to load generated patient data';
          try {
            const errorBody = await resultsResponse.json();
            detail = errorBody.detail || errorBody.message || detail;
          } catch {
            // Keep the generic error if the response body is not JSON.
          }
          throw new Error(detail);
        }

        const data = await resultsResponse.json();
        const loadedPatients = loadPatientsFromData(data);

        if (!isCancelled) {
          setPatients(loadedPatients);
          setDataSourceLabel(`Loaded from generator job ${jobId}`);
        }
      } catch (error) {
        if (!isCancelled) {
          setRemoteError(error instanceof Error ? error.message : 'Failed to load remote patient data');
        }
      } finally {
        if (!isCancelled) {
          setIsRemoteLoading(false);
        }
      }
    };

    loadRemotePatients();

    return () => {
      isCancelled = true;
    };
  }, []);

  // Timeline playback effect
  useEffect(() => {
    if (!playbackState.isPlaying) return;

    const interval = setInterval(() => {
      setPlaybackState(prev => {
        // Adjust speed to make timeline much slower - divide by 10 for more realistic playback
        const adjustedSpeed = prev.speed / 10;
        const nextTime = new Date(prev.currentTime.getTime() + (3600000 * adjustedSpeed)); // Advance by 1 hour * adjustedSpeed
        
        // Handle end of timeline
        if (nextTime >= prev.endTime) {
          if (prev.isLooping) {
            // Loop back to start
            return {
              ...prev,
              currentTime: prev.startTime
            };
          } else {
            // Stop at end
            return {
              ...prev,
              currentTime: prev.endTime,
              isPlaying: false
            };
          }
        }
        
        return {
          ...prev,
          currentTime: nextTime
        };
      });
    }, 100); // Update every 100ms for smooth animation

    return () => clearInterval(interval);
  }, [playbackState.isPlaying, playbackState.speed, playbackState.isLooping]);

  useEffect(() => {
    if (!playbackState.isPlaying) {
      return;
    }

    setSelectedPatient(null);
    setInspectorMode(null);
  }, [playbackState.isPlaying]);

  // Control handlers
  const handlePlayPause = () => {
    setPlaybackState(prev => ({
      ...prev,
      isPlaying: !prev.isPlaying
    }));
  };

  const handleSpeedChange = (speed: number) => {
    setPlaybackState(prev => ({
      ...prev,
      speed
    }));
  };

  const handleReset = () => {
    setPlaybackState(prev => ({
      ...prev,
      currentTime: prev.startTime,
      isPlaying: false
    }));
  };

  const handleTimeSeek = (time: Date) => {
    setPlaybackState(prev => ({
      ...prev,
      currentTime: time,
      isPlaying: false
    }));
  };

  const handleLoopToggle = () => {
    setPlaybackState(prev => ({
      ...prev,
      isLooping: !prev.isLooping
    }));
  };

  const handleLoadPatients = (loadedPatients: Patient[]) => {
    setPatients(loadedPatients);
    setRemoteError(null);
    setDataSourceLabel('Loaded from local file');
    console.log(`Loaded ${loadedPatients.length} patients`);
  };

  const generatorUrl = useMemo(() => {
    const { protocol, hostname, port } = window.location;

    if (port === '5174') {
      return `${protocol}//${hostname}:8000/static/index.html`;
    }

    return '/static/index.html';
  }, []);

  const handleClearFilters = () => {
    setFilters(initialFilterState);
  };

  const handlePatientInspect = (patient: Patient, mode: InspectorMode) => {
    if (playbackState.isPlaying) {
      return;
    }

    const isSamePatient = selectedPatient?.id === patient.id;
    const isSameMode = inspectorMode === mode;

    if (isSamePatient && isSameMode) {
      setSelectedPatient(null);
      setInspectorMode(null);
      return;
    }

    setSelectedPatient(patient);
    setInspectorMode(mode);
  };

  const handleCloseInspector = () => {
    setSelectedPatient(null);
    setInspectorMode(null);
  };

  // Calculate statistics and cumulative KIA/RTD counts
  const statistics = useMemo(() => {
    if (patients.length === 0) return null;

    const totalPatients = patients.length;
    const filteredCount = filteredPatients.length;

    const finalStatuses = patients.reduce((acc, patient) => {
      acc[patient.final_status] = (acc[patient.final_status] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    const triageCounts = patients.reduce((acc, patient) => {
      acc[patient.triage_category] = (acc[patient.triage_category] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    // Calculate current status counts for filtered patients
    const currentStatuses = { KIA: 0, RTD: 0, Active: 0 };

    filteredPatients.forEach(patient => {
      if (patient.movement_timeline) {
        const injuryTimeStr = patient.injury_timestamp || (patient as any).injury_time;
        const injuryTime = injuryTimeStr
          ? new Date(injuryTimeStr)
          : new Date('2024-01-01T00:00:00Z');
        const currentHours = (playbackState.currentTime.getTime() - injuryTime.getTime()) / (1000 * 60 * 60);

        // Only count patients whose injury has occurred
        if (currentHours >= 0) {
          const eventsSoFar = patient.movement_timeline.filter(
            event => event.hours_since_injury <= currentHours
          );
          const kiaEvent = eventsSoFar.find(event => event.event_type === 'kia');
          const rtdEvent = eventsSoFar.find(event => event.event_type === 'rtd');

          if (kiaEvent) {
            currentStatuses.KIA++;
          } else if (rtdEvent) {
            currentStatuses.RTD++;
          } else {
            currentStatuses.Active++;
          }
        }
      }
    });

    return {
      total: totalPatients,
      filtered: filteredCount,
      finalStatuses,
      triageCounts,
      currentStatuses
    };
  }, [patients, filteredPatients, playbackState.currentTime]);

  // Calculate cumulative KIA/RTD counts up to current time for each facility
  const cumulativeCounts = useMemo(() => {
    if (filteredPatients.length === 0) return {};

    const counts: Record<FacilityName, { kia: number; rtd: number }> = {
      POI: { kia: 0, rtd: 0 },
      Role1: { kia: 0, rtd: 0 },
      Role2: { kia: 0, rtd: 0 },
      Role3: { kia: 0, rtd: 0 },
      Role4: { kia: 0, rtd: 0 }
    };

    filteredPatients.forEach(patient => {
      // Check if patient has ever been KIA or RTD up to this point in time
      if (patient.movement_timeline) {
        const injuryTime = new Date((patient.injury_timestamp || (patient as any).injury_time) ?? '2024-01-01T00:00:00Z');
        const currentHours = (playbackState.currentTime.getTime() - injuryTime.getTime()) / (1000 * 60 * 60);
        
        const eventsSoFar = patient.movement_timeline.filter(event => event.hours_since_injury <= currentHours);
        const kiaEvent = eventsSoFar.find(event => event.event_type === 'kia');
        const rtdEvent = eventsSoFar.find(event => event.event_type === 'rtd');
        
        if (kiaEvent) {
          // POI gets all KIAs that happen before Role1 (including at POI)
          const facilityAtDeath = kiaEvent.facility as FacilityName || 'POI';
          
          // Check if patient ever reached Role1 before dying
          const role1Event = eventsSoFar.find(event => 
            event.facility === 'Role1' && event.hours_since_injury < kiaEvent.hours_since_injury
          );
          
          if (!role1Event || facilityAtDeath === 'POI') {
            // Patient died before reaching Role1, or died at POI - count as POI KIA
            counts.POI.kia++;
          } else {
            // Patient died at specific facility after reaching Role1
            if (counts[facilityAtDeath]) {
              counts[facilityAtDeath].kia++;
            }
          }
        } else if (rtdEvent) {
          // RTD always goes to the facility where it happened
          const facilityAtRTD = rtdEvent.facility as FacilityName || 'POI';
          if (counts[facilityAtRTD]) {
            counts[facilityAtRTD].rtd++;
          }
        }
      }
    });

    return counts;
  }, [filteredPatients, playbackState.currentTime]);

  const selectedPatientLocation = selectedPatient
    ? getPatientLocationAtTime(selectedPatient, playbackState.currentTime)
    : null;
  const selectedPatientCurrentHours = selectedPatient
    ? (playbackState.currentTime.getTime() - new Date((selectedPatient.injury_timestamp || (selectedPatient as any).injury_time) ?? '2024-01-01T00:00:00Z').getTime()) / (1000 * 60 * 60)
    : null;
  const isInspectorExpanded = Boolean(selectedPatient && inspectorMode && !playbackState.isPlaying);
  const inspectorPatient = isInspectorExpanded ? selectedPatient : null;
  const inspectorMessage = playbackState.isPlaying
    ? 'Pause playback to inspect a patient.'
    : selectedPatient && inspectorMode === 'json'
      ? 'Raw patient data at the current pause point.'
      : selectedPatient
        ? 'Patient detail snapshot at the current pause point.'
        : 'Click a patient for details or right-click for JSON.';

  return (
    <div className="h-screen flex flex-col bg-gray-100">
      {/* Header */}
      <header className="bg-white shadow-sm border-b border-gray-200 p-2">
        <div className="w-full px-4">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-xl font-bold text-gray-900">
                Patient Timeline Visualizer by Markus Sandelin <small className="text-xs text-gray-500">- D2S/DevContainer Version - 18 Apr 2026</small>
              </h1>
              <p className="text-sm text-gray-600">
                Military Medical Evacuation Flow Simulator
              </p>
            </div>
            <a
              href={generatorUrl}
              className="inline-flex items-center rounded-md border border-cyan-200 bg-cyan-50 px-3 py-2 text-sm font-medium text-cyan-700 hover:bg-cyan-100"
            >
              Back to Generator
            </a>
          </div>
        </div>
      </header>

      {/* Main content */}
      <main className="flex-1 flex flex-col overflow-hidden">
        {patients.length === 0 ? (
          // File upload state
            <div className="flex-1 flex items-center justify-center">
              <div className="max-w-2xl w-full px-4">
                <FileUploader onLoad={handleLoadPatients} isLoading={isRemoteLoading} />

                {isRemoteLoading && (
                  <div className="mt-4 rounded-lg border border-cyan-200 bg-cyan-50 p-4 text-sm text-cyan-800">
                    Loading generated patient data directly from the main application...
                  </div>
                )}

                {remoteError && (
                  <div className="mt-4 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
                    {remoteError}
                  </div>
                )}
                
                {/* Instructions */}
                <div className="mt-8 bg-blue-50 border border-blue-200 rounded-lg p-6">
                  <h3 className="font-semibold text-blue-900 mb-3">How to use:</h3>
                  <ol className="list-decimal list-inside space-y-2 text-blue-800 text-sm">
                    <li>Generate patient data from the main application</li>
                    <li>Use the new direct handoff from the generator, or download the patients.json file</li>
                    <li>Upload the file using the drag-and-drop area above if you are loading manually</li>
                    <li>Use the timeline controls to visualize patient flow</li>
                    <li>Watch patients move through POI → Role1 → Role2 → Role3 → Role4</li>
                  </ol>
                </div>
              </div>
          </div>
        ) : (
          // Timeline visualization
          <>
            {/* Statistics bar */}
            {statistics && (
              <div className="bg-white border-b border-gray-200 p-2">
                <div className="w-full px-4 flex items-center justify-between">
                  <div className="flex items-center space-x-4 text-sm">
                    <span className="font-medium">
                      Showing: {statistics.filtered}/{statistics.total}
                    </span>
                    {dataSourceLabel && (
                      <span className="text-gray-500">
                        {dataSourceLabel}
                      </span>
                    )}
                    <div className="flex space-x-2">
                      <span className="text-red-600">
                        KIA: {statistics.currentStatuses.KIA}
                      </span>
                      <span className="text-green-600">
                        RTD: {statistics.currentStatuses.RTD}
                      </span>
                      <span className="text-blue-600">
                        Active: {statistics.currentStatuses.Active}
                      </span>
                    </div>
                  </div>
                  <div className="flex space-x-2 text-sm">
                    <span className="bg-red-100 text-red-800 px-2 py-0.5 rounded">
                      T1: {statistics.triageCounts.T1 || 0}
                    </span>
                    <span className="bg-yellow-100 text-yellow-800 px-2 py-0.5 rounded">
                      T2: {statistics.triageCounts.T2 || 0}
                    </span>
                    <span className="bg-green-100 text-green-800 px-2 py-0.5 rounded">
                      T3: {statistics.triageCounts.T3 || 0}
                    </span>
                  </div>
                </div>
              </div>
            )}

            {/* Filter bar */}
            <FilterBar
              patients={patients}
              filters={filters}
              onFilterChange={setFilters}
              onClearFilters={handleClearFilters}
            />

            {/* Facility columns */}
            <div className="flex-1 min-h-0 p-2 overflow-hidden">
              <div className="flex h-full min-h-0 flex-col gap-2 xl:flex-row">
                <div className="min-w-0 flex-1 overflow-x-auto xl:overflow-hidden">
                  <div className="grid h-full min-h-0 min-w-[960px] grid-cols-5 gap-2 xl:min-w-0">
                    <AnimatePresence>
                      {FACILITIES.map((facility) => (
                        <FacilityColumn
                          key={facility}
                          name={facility}
                          patients={filteredPatients}
                          currentTime={playbackState.currentTime}
                          cumulativeCounts={(cumulativeCounts as any)[facility] || { kia: 0, rtd: 0 }}
                          className="h-full min-h-0"
                          isInteractionEnabled={!playbackState.isPlaying}
                          onPatientInspect={(patient) => handlePatientInspect(patient, 'details')}
                          onPatientInspectJson={(patient) => handlePatientInspect(patient, 'json')}
                        />
                      ))}
                    </AnimatePresence>
                  </div>
                </div>

                <aside className={`flex w-full shrink-0 flex-col overflow-hidden rounded-lg border border-slate-300 bg-white shadow-sm xl:w-96 ${isInspectorExpanded ? 'min-h-0 max-h-[45vh] xl:h-full xl:max-h-none' : 'self-start'}`}>
                  {isInspectorExpanded ? (
                    <>
                      <div className="border-b border-slate-200 px-4 py-3">
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                              Patient Inspector
                            </p>
                            <h2 className="text-lg font-semibold text-slate-900">
                              {getPatientDisplayName(inspectorPatient!)}
                            </h2>
                            <p className="text-sm text-slate-600">{inspectorMessage}</p>
                          </div>

                          <button
                            type="button"
                            onClick={handleCloseInspector}
                            className="rounded-md border border-slate-300 px-2 py-1 text-sm text-slate-600 hover:bg-slate-50"
                          >
                            Clear
                          </button>
                        </div>
                      </div>

                      <div className="min-h-0 flex-1 overflow-y-auto p-4">
                        {inspectorMode === 'json' ? (
                      <pre className="overflow-x-auto rounded-lg bg-slate-950 p-4 text-xs leading-5 text-slate-100">
                        {JSON.stringify(inspectorPatient, null, 2)}
                      </pre>
                    ) : (
                      <div className="space-y-4 text-sm text-slate-700">
                        <div className="grid grid-cols-2 gap-3">
                          <div className="rounded-lg bg-slate-50 p-3">
                            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Patient ID</p>
                            <p className="mt-1 font-medium text-slate-900">{inspectorPatient!.id}</p>
                          </div>
                          <div className="rounded-lg bg-slate-50 p-3">
                            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Triage</p>
                            <p className="mt-1 font-medium text-slate-900">{inspectorPatient!.triage_category}</p>
                          </div>
                          <div className="rounded-lg bg-slate-50 p-3">
                            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Nationality</p>
                            <p className="mt-1 font-medium text-slate-900">{inspectorPatient!.nationality || 'Unknown'}</p>
                          </div>
                          <div className="rounded-lg bg-slate-50 p-3">
                            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Current location</p>
                            <p className="mt-1 font-medium text-slate-900">{formatLocationLabel(selectedPatientLocation)}</p>
                          </div>
                          <div className="rounded-lg bg-slate-50 p-3">
                            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Condition</p>
                            <p className="mt-1 font-medium text-slate-900">{getPatientConditionLabel(inspectorPatient!)}</p>
                          </div>
                          <div className="rounded-lg bg-slate-50 p-3">
                            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Final status</p>
                            <p className="mt-1 font-medium text-slate-900">{inspectorPatient!.final_status}</p>
                          </div>
                          <div className="rounded-lg bg-slate-50 p-3">
                            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Front</p>
                            <p className="mt-1 font-medium text-slate-900">{inspectorPatient!.front || 'Unknown'}</p>
                          </div>
                          <div className="rounded-lg bg-slate-50 p-3">
                            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Injury time</p>
                            <p className="mt-1 font-medium text-slate-900">
                              {formatTimestamp(inspectorPatient!.injury_timestamp || (inspectorPatient as any).injury_time)}
                            </p>
                          </div>
                        </div>

                        <div>
                          <div className="mb-2 flex items-center justify-between">
                            <h3 className="text-sm font-semibold text-slate-900">Timeline</h3>
                            <span className="text-xs text-slate-500">
                              {inspectorPatient!.movement_timeline.length} events
                            </span>
                          </div>

                          <div className="space-y-2">
                            {inspectorPatient!.movement_timeline.map((event, index) => {
                              const isPastEvent = selectedPatientCurrentHours !== null
                                && event.hours_since_injury <= selectedPatientCurrentHours;
                              const facilityLabel = event.facility || event.to_facility || event.destination_facility || 'In transit';

                              return (
                                <div
                                  key={`${inspectorPatient!.id}-${event.timestamp}-${index}`}
                                  className={`rounded-lg border p-3 ${isPastEvent
                                    ? 'border-cyan-200 bg-cyan-50'
                                    : 'border-slate-200 bg-white'
                                  }`}
                                >
                                  <div className="flex items-center justify-between gap-3">
                                    <p className="font-medium text-slate-900">{formatEventType(event.event_type)}</p>
                                    <span className="text-xs text-slate-500">
                                      +{event.hours_since_injury.toFixed(1)}h
                                    </span>
                                  </div>
                                  <p className="mt-1 text-slate-700">{facilityLabel}</p>
                                  <p className="mt-1 text-xs text-slate-500">{formatTimestamp(event.timestamp)}</p>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      </div>
                        )}
                      </div>
                    </>
                  ) : (
                    <div className="px-4 py-2 text-sm text-slate-600">
                      <span className="font-medium text-slate-900">Patient Inspector:</span> {playbackState.isPlaying
                        ? ' pause playback to inspect a patient.'
                        : ' click for details or right-click for JSON.'}
                    </div>
                  )}
                </aside>
              </div>
            </div>

            {/* Timeline controls */}
            <TimelineControls
              playbackState={playbackState}
              onPlayPause={handlePlayPause}
              onSpeedChange={handleSpeedChange}
              onReset={handleReset}
              onTimeSeek={handleTimeSeek}
              onLoopToggle={handleLoopToggle}
            />
          </>
        )}
      </main>
    </div>
  );
}

export default App;
