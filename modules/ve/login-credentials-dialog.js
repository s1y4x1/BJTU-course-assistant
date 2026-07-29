(function (global) {
  'use strict';

  function open(options = {}) {
    return new Promise((resolve) => {
      const modal = options.modal;
      if (!(modal instanceof HTMLElement)) return resolve({ action: 'cancel' });

      const message = options.message;
      const choice = options.choice;
      const manual = options.manual;
      const plainInput = options.plainInput;
      const encryptedInput = options.encryptedInput;
      const captchaWrap = options.captchaWrap;
      const captchaImage = options.captchaImage;
      const passcodeInput = options.passcodeInput;
      const buttons = options.buttons || {};
      const loginName = String(options.loginName || '').trim();
      const requireCaptcha = options.requireCaptcha === true;
      const startManual = options.startManual === true;
      const fallbackPassword = String(options.fallbackPassword || '').trim();
      const encryptPassword = typeof options.encryptPassword === 'function' ? options.encryptPassword : () => '';
      const loadCaptcha = typeof options.loadCaptcha === 'function' ? options.loadCaptcha : null;
      const recognizeCaptcha = typeof options.recognizeCaptcha === 'function' ? options.recognizeCaptcha : null;
      const initialMessageText = String(options.messageText || '账号或密码错误');
      let captchaUrl = String(options.initialCaptchaUrl || '');
      let captchaLoading = false;
      let captchaVersion = 0;
      let settled = false;

      const finish = (value) => {
        if (settled) return;
        settled = true;
        captchaVersion += 1;
        cleanup();
        modal.style.display = 'none';
        resolve(value);
      };
      const recognizeCurrentCaptcha = async (imageUrl, version) => {
        if (!(passcodeInput instanceof HTMLInputElement) || !recognizeCaptcha || !imageUrl) return;
        passcodeInput.value = '';
        passcodeInput.placeholder = '正在识别';
        passcodeInput.dataset.recognizing = '1';
        let failed = false;
        try {
          const passcode = String(await recognizeCaptcha(imageUrl) || '').replace(/\D/g, '').slice(0, 4);
          if (settled || version !== captchaVersion) return;
          if (passcode.length !== 4) throw new Error('未能识别出 4 位数字');
          if (!/^\d{4}$/.test(passcodeInput.value)) passcodeInput.value = passcode;
          if (message instanceof HTMLElement) message.textContent = initialMessageText;
        } catch (error) {
          failed = true;
          if (message instanceof HTMLElement) {
            message.textContent = '验证码识别失败：' + String(error?.message || error);
          }
        } finally {
          if (!settled && version === captchaVersion) {
            delete passcodeInput.dataset.recognizing;
            passcodeInput.placeholder = failed && !passcodeInput.value ? '识别失败' : '输入 4 位验证码';
          }
        }
      };
      const refreshCaptcha = async () => {
        if (!requireCaptcha || !loadCaptcha || captchaLoading) return;
        captchaLoading = true;
        const version = ++captchaVersion;
        if (passcodeInput instanceof HTMLInputElement) {
          passcodeInput.value = '';
          passcodeInput.placeholder = '正在获取';
          passcodeInput.dataset.fetching = '1';
        }
        try {
          captchaUrl = String(await loadCaptcha() || '');
          if (!captchaUrl) throw new Error('验证码图片为空');
          if (captchaImage instanceof HTMLImageElement) captchaImage.src = captchaUrl;
          if (passcodeInput instanceof HTMLInputElement) delete passcodeInput.dataset.fetching;
          await recognizeCurrentCaptcha(captchaUrl, version);
          passcodeInput?.focus();
        } catch (error) {
          if (message instanceof HTMLElement) message.textContent = '验证码图片获取失败：' + String(error?.message || error);
          if (!settled && version === captchaVersion && passcodeInput instanceof HTMLInputElement) {
            passcodeInput.placeholder = '输入 4 位验证码';
          }
        } finally {
          if (passcodeInput instanceof HTMLInputElement) delete passcodeInput.dataset.fetching;
          captchaLoading = false;
        }
      };
      const onReinitialize = () => finish({ action: 'reinitialize' });
      const onManual = () => {
        if (choice instanceof HTMLElement) choice.style.display = 'none';
        if (manual instanceof HTMLElement) manual.style.display = 'block';
        if (plainInput instanceof HTMLInputElement) {
          plainInput.value = '';
          plainInput.placeholder = fallbackPassword ? '留空则使用已保存密码' : '密码明文';
        }
        if (encryptedInput instanceof HTMLInputElement) encryptedInput.value = '';
        if (captchaWrap instanceof HTMLElement) captchaWrap.style.display = requireCaptcha ? 'flex' : 'none';
        if (captchaImage instanceof HTMLImageElement && captchaUrl) captchaImage.src = captchaUrl;
        if (passcodeInput instanceof HTMLInputElement) passcodeInput.value = '';
        if (requireCaptcha) {
          if (captchaUrl) {
            const version = ++captchaVersion;
            void recognizeCurrentCaptcha(captchaUrl, version);
            passcodeInput?.focus();
          }
          else void refreshCaptcha();
        } else {
          plainInput?.focus();
        }
      };
      const onCancel = () => finish({ action: 'cancel' });
      const onDefault = () => {
        if (!(plainInput instanceof HTMLInputElement)) return;
        plainInput.value = 'Bjtu@' + loginName;
        if (encryptedInput instanceof HTMLInputElement) encryptedInput.value = encryptPassword(plainInput.value);
        plainInput.focus();
      };
      const onPlainInput = () => {
        if (!(plainInput instanceof HTMLInputElement) || !(encryptedInput instanceof HTMLInputElement)) return;
        encryptedInput.value = plainInput.value ? encryptPassword(plainInput.value) : '';
      };
      const onEncryptedInput = () => {
        if (!(encryptedInput instanceof HTMLInputElement)) return;
        encryptedInput.value = String(encryptedInput.value || '').replace(/[^0-9a-f]/gi, '').slice(0, 256).toUpperCase();
      };
      const onPasscodeInput = () => {
        if (!(passcodeInput instanceof HTMLInputElement)) return;
        passcodeInput.value = String(passcodeInput.value || '').replace(/\D/g, '').slice(0, 4);
      };
      const onSubmit = () => {
        const plain = String(plainInput?.value || '');
        const password = plain ? encryptPassword(plain) : String(encryptedInput?.value || '').trim() || fallbackPassword;
        if (!/^(?:[0-9a-f]{16})+$/i.test(password)) {
          encryptedInput?.focus();
          return;
        }
        const passcode = String(passcodeInput?.value || '').replace(/\D/g, '').slice(0, 4);
        if (requireCaptcha && passcode.length !== 4) {
          passcodeInput?.focus();
          return;
        }
        finish({ action: 'password', password, passwordPlain: plain, passcode });
      };
      const onKeyDown = (event) => {
        if (event.key !== 'Enter') return;
        event.preventDefault();
        onSubmit();
      };
      const onMaskDown = (event) => { modal.dataset.maskDown = event.target === modal ? '1' : '0'; };
      const onMaskUp = (event) => {
        if (event.target === modal && modal.dataset.maskDown === '1') onCancel();
        delete modal.dataset.maskDown;
      };
      const cleanup = () => {
        buttons.reinitialize?.removeEventListener('click', onReinitialize);
        buttons.manual?.removeEventListener('click', onManual);
        buttons.cancel?.removeEventListener('click', onCancel);
        buttons.fillDefault?.removeEventListener('click', onDefault);
        buttons.submit?.removeEventListener('click', onSubmit);
        buttons.manualCancel?.removeEventListener('click', onCancel);
        plainInput?.removeEventListener('input', onPlainInput);
        encryptedInput?.removeEventListener('input', onEncryptedInput);
        passcodeInput?.removeEventListener('input', onPasscodeInput);
        plainInput?.removeEventListener('keydown', onKeyDown);
        encryptedInput?.removeEventListener('keydown', onKeyDown);
        passcodeInput?.removeEventListener('keydown', onKeyDown);
        captchaImage?.removeEventListener('click', refreshCaptcha);
        modal.removeEventListener('mousedown', onMaskDown);
        modal.removeEventListener('mouseup', onMaskUp);
      };

      if (message instanceof HTMLElement) message.textContent = initialMessageText;
      if (choice instanceof HTMLElement) choice.style.display = startManual ? 'none' : 'flex';
      if (manual instanceof HTMLElement) manual.style.display = 'none';
      buttons.reinitialize?.addEventListener('click', onReinitialize);
      buttons.manual?.addEventListener('click', onManual);
      buttons.cancel?.addEventListener('click', onCancel);
      buttons.fillDefault?.addEventListener('click', onDefault);
      buttons.submit?.addEventListener('click', onSubmit);
      buttons.manualCancel?.addEventListener('click', onCancel);
      plainInput?.addEventListener('input', onPlainInput);
      encryptedInput?.addEventListener('input', onEncryptedInput);
      passcodeInput?.addEventListener('input', onPasscodeInput);
      plainInput?.addEventListener('keydown', onKeyDown);
      encryptedInput?.addEventListener('keydown', onKeyDown);
      passcodeInput?.addEventListener('keydown', onKeyDown);
      captchaImage?.addEventListener('click', refreshCaptcha);
      modal.addEventListener('mousedown', onMaskDown);
      modal.addEventListener('mouseup', onMaskUp);
      modal.style.display = 'flex';
      if (startManual) onManual();
    });
  }

  global.BjtuVeLoginCredentialsDialog = { open };
})(globalThis);
