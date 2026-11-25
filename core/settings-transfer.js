(function(global){
  'use strict';
  const dataKeys=new Set(['llmSettingsMigrated1','chatroomState','llmProactiveMessages','llmExecutionHistory','homeworkBackgroundKnownAssignments','versionAutoReloadCompleted','savedUploads','savedUploadedFiles','extensionDownloads']);
  function isSetting(key){
    return !dataKeys.has(key)
      && !/(?:cache|snapshots?)(?::|$)/i.test(key)
      && !/^(?:llmApiChat:|llmLocalChat:|homeworkReminder(?:Snapshot|Observed|Notified)|homeworkBackgroundKnownAssignments)/.test(key)
      && !/(?:Status|Progress|PendingNotifications|NotificationTargets|Notified|Observed|Events)(?::|$)/.test(key);
  }
  function prepare(stored){
    const settings=Object.fromEntries(Object.entries(stored).filter(([key])=>isSetting(key)));
    settings.fontSizeSettings=global.BjtuTypography.normalizeSettings(stored.fontSizeSettings);
    settings.colorSettings={...global.BjtuColors.defaults,...global.BjtuColors.normalize(stored.colorSettings)};
    return settings;
  }
  async function collect(area){
    if(typeof area.getKeys==='function')return prepare(await area.get((await area.getKeys()).filter(isSetting)));
    return prepare(await area.get(null));
  }
  global.BjtuSettingsTransfer={isSetting,prepare,collect};
})(globalThis);
