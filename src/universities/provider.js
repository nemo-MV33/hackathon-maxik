/**
 * Общий контракт источника расписания. Наружу передаются только нормализованные данные.
 * Идентификаторы здесь числовые, как у источника; UniversityService добавляет вуз.
 *
 * @typedef {object} ScheduleProvider
 * @property {function(): Promise<Array<object>>} groups
 * @property {function(): Promise<Array<string>>} institutes
 * @property {function(string, object=): Promise<Array<object>>} searchGroups
 * @property {function(): Promise<Array<object>>} teachers
 * @property {function(): Promise<Array<object>>} auditories
 * @property {function(string, object=): Promise<Array<object>>} searchTeachers
 * @property {function(string, object=): Promise<Array<object>>} searchAuditories
 * @property {function(number, object=): Promise<object>} groupSchedule
 * @property {function(number, object=): Promise<object>} teacherSchedule
 * @property {function(number, object=): Promise<object>} auditorySchedule
 *
 * Неделя: {period: {from: Date, to: Date}, weekEven, updatedAt, stale?, lessons}.
 * Пара: {date, lessonNumber, time, subject, lessonType, subgroup, teachers, auditories}.
 * date и time относятся к часовому поясу вуза. Сбой источника должен возвращать
 * последнее успешное расписание с исходным updatedAt либо выбрасывать ошибку.
 * Неизвестная разметка и недоступность никогда не означают пустое расписание.
 * Необязательные возможности перечислены в config.js; пустой справочник допустим
 * только при соответствующем capabilities=false.
 */
export class UnsupportedScheduleError extends Error {
  constructor() { super('capability_not_supported'); this.code = 'capability_not_supported'; }
}
