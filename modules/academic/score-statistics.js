(function initBjtuAcademicScoreStatistics(global) {
  'use strict';

  const FIVE_LEVEL_GRADE_VALUES = Object.freeze({
    A: { point: 4.0, score: 95 },
    'A-': { point: 3.7, score: 87 },
    'B+': { point: 3.3, score: 83 },
    B: { point: 3.0, score: 79 },
    'B-': { point: 2.7, score: 76 },
    'C+': { point: 2.3, score: 73 },
    C: { point: 2.0, score: 69 },
    'C-': { point: 1.7, score: 66 },
    'D+': { point: 1.3, score: 63 },
    D: { point: 1.0, score: 60 },
    F: { point: 0, score: 30 }
  });

  function percentageGradePoint(score) {
    if (score >= 90) return 4.0;
    if (score >= 85) return 3.7;
    if (score >= 81) return 3.3;
    if (score >= 78) return 3.0;
    if (score >= 75) return 2.7;
    if (score >= 71) return 2.3;
    if (score >= 68) return 2.0;
    if (score >= 65) return 1.7;
    if (score >= 61) return 1.3;
    if (score >= 60) return 1.0;
    return 0;
  }

  function gradeValues(value) {
    const grade = String(value ?? '').trim().toUpperCase();
    if (Object.prototype.hasOwnProperty.call(FIVE_LEVEL_GRADE_VALUES, grade)) {
      return FIVE_LEVEL_GRADE_VALUES[grade];
    }
    if (!/^(?:100(?:\.0+)?|\d{1,2}(?:\.\d+)?)$/.test(grade)) return null;
    const score = Number(grade);
    if (!Number.isFinite(score) || score < 0 || score > 100) return null;
    return { point: percentageGradePoint(score), score };
  }

  function calculate(rows) {
    let credits = 0;
    let courseCount = 0;
    let weightedPoints = 0;
    let weightedScores = 0;
    for (const row of (Array.isArray(rows) ? rows : [])) {
      const credit = Number.parseFloat(String(row?.credit ?? '').trim());
      const grade = gradeValues(row?.score);
      if (!Number.isFinite(credit) || credit <= 0 || !grade) continue;
      credits += credit;
      courseCount += 1;
      weightedPoints += grade.point * credit;
      weightedScores += grade.score * credit;
    }
    if (credits <= 0) return null;
    const averageGpaText = (weightedPoints / credits).toFixed(2);
    const weightedAverageScoreText = (weightedScores / credits).toFixed(1);
    return {
      averageGpa: Number(averageGpaText),
      weightedAverageScore: Number(weightedAverageScoreText),
      averageGpaText,
      weightedAverageScoreText,
      credits,
      courseCount
    };
  }

  global.BjtuAcademicScoreStatistics = Object.freeze({ calculate });
})(globalThis);
