import { Patient } from '../types/patient.types';

export function loadPatientsFromData(data: unknown): Patient[] {
  let patientsArray: any[];

  if (Array.isArray(data)) {
    patientsArray = data;
  } else if (data && typeof data === 'object' && 'patients' in data && Array.isArray((data as any).patients)) {
    patientsArray = (data as any).patients;
  } else {
    throw new Error('Data must contain an array of patients or a {patients: [...]} structure');
  }

  const extractedPatients = patientsArray.map((item: any) => item?.patient ?? item);

  const validPatients = extractedPatients.filter((patient: any) => {
    if (!patient) {
      return false;
    }

    const nationality = patient.nationality || patient.demographics?.nationality;

    let triage = patient.triage_category;
    if (!triage && Array.isArray(patient.movement_timeline)) {
      const triageEvent = patient.movement_timeline.find((event: any) => event.triage_category);
      triage = triageEvent?.triage_category;
    }

    let finalStatus = patient.final_status;
    if (!finalStatus && patient.status) {
      const statusMap: Record<string, string> = {
        KIA: 'KIA',
        DOW: 'KIA',
        RTD: 'RTD',
        Role4: 'Remains_Role4',
        Remains_Role4: 'Remains_Role4',
        Role3: 'Remains_Role4',
        Role2: 'Remains_Role4',
        Role1: 'Remains_Role4'
      };
      finalStatus = statusMap[patient.status] || 'Remains_Role4';
    }

    const isValid =
      (typeof patient.id === 'string' || typeof patient.id === 'number') &&
      typeof nationality === 'string' &&
      ['T1', 'T2', 'T3'].includes(triage) &&
      ['KIA', 'RTD', 'Remains_Role4'].includes(finalStatus) &&
      Array.isArray(patient.movement_timeline);

    if (isValid) {
      patient.nationality = nationality;
      patient.triage_category = triage;
      patient.final_status = finalStatus;
      patient.gender = patient.gender || patient.demographics?.gender;
    }

    return isValid;
  });

  if (validPatients.length === 0) {
    throw new Error('No valid patients found in the provided data');
  }

  return validPatients as Patient[];
}
