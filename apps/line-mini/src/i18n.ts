/**
 * 轻量双语 i18n（英文默认 / 泰文，PRD §17；默认语言按需求定为英文）。
 * - Vue 适配：src/i18nVue.ts（customRef 让 t() 在模板中响应语言切换）
 * - 语言持久化在 localStorage['app_lang']，默认英文
 */

export type Locale = 'en' | 'th';
export type Params = Record<string, string | number>;

const LANG_KEY = 'app_lang';

function detectInitial(): Locale {
  try {
    const saved = localStorage.getItem(LANG_KEY);
    if (saved === 'en' || saved === 'th') return saved;
  } catch {
    /* localStorage 不可用时用默认值 */
  }
  return 'en';
}

let current: Locale = detectInitial();
document.documentElement.lang = current;

const listeners = new Set<() => void>();

/** 当前语言 */
export function getLocale(): Locale {
  return current;
}

/** 切换语言并持久化 */
export function setLocale(l: Locale): void {
  if (l === current) return;
  current = l;
  try {
    localStorage.setItem(LANG_KEY, l);
  } catch {
    /* ignore */
  }
  document.documentElement.lang = l;
  listeners.forEach((fn) => fn());
}

/** 订阅语言变化，返回取消订阅函数 */
export function subscribeLocale(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

type Dict = Record<string, string>;

const en: Dict = {
  // 通用
  'common.loading': 'Loading…',
  'common.retry': 'Retry',
  'common.cancel': 'Cancel',
  'common.save': 'Save',
  'common.confirm': 'Confirm',
  'common.delete': 'Delete',
  'common.done': 'Done',
  'common.back': 'Back',
  'common.unknownError': 'Unknown error',
  'common.search': 'Search',
  'common.empty': 'Nothing here yet',
  'common.close': 'Close',

  // P01 启动页
  'boot.connecting': 'Connecting to LINE…',
  'boot.poweredBy': 'Powered by LINE MINI App',

  // 登录
  'login.withLine': 'Login with LINE',
  'login.devTitle': 'Developer sign-in',
  'login.devHint': 'Local dev: both LINE buttons sign in directly with this ID. Change it to create another account.',
  'login.devPlaceholder': 'Dev ID',
  'login.devSubmit': 'Sign in',
  'login.failed': 'Sign-in failed',

  // 登录 / 注册（确认结果后进入）
  'auth.tabLogin': 'Sign in',
  'auth.tabRegister': 'Register',
  'auth.loginHint': 'Sign in with LINE to save this result and continue.',
  'auth.registerHint': 'Register with LINE — your account is created automatically.',
  'auth.registerWithLine': 'Register with LINE',
  'auth.registerNote': 'No password needed. Your guest files and results will be moved to your account.',

  // 底部导航
  'nav.scan': 'SCAN',
  'nav.history': 'HISTORY',
  'nav.my': 'MY',

  // P02 扫描主页
  'home.recent': 'Recent tasks',
  'home.importUrl': 'Import from URL',
  'home.urlPlaceholder': 'https://example.com/invoice.pdf',
  'home.urlSubmit': 'Import',
  'home.camera': 'Camera',
  'home.photos': 'Photos',
  'home.files': 'Files',
  'home.pickHint': 'JPG / PNG / PDF, up to {size}MB',
  'home.workspacePersonal': 'Personal',
  'home.uploading': 'Uploading… {pct}%',
  'home.quotaLeft': '{plan} · {left} / {total} free scans left',
  'home.quotaLeftPaid': '{plan} · {left} / {total} pages left this month',
  'home.plansLink': 'Plans ›',
  'home.freeBadge': 'Sign-in bonus',

  // 任务流程阶段
  'job.stage.OCR_PROCESSING': 'OCR processing',
  'job.stage.OCR_FAILED': 'OCR failed',
  'job.stage.VERIFYING': 'Verifying',
  'job.stage.VERIFIED': 'Verified',
  'job.stage.COMPLETED': 'Completed',
  'job.review.UNREVIEWED': 'Unreviewed',
  'job.review.EDITED': 'Edited',
  'job.review.CONFIRMED': 'Confirmed',

  // P03 确认文档
  'confirm.title': 'Confirm document',
  'confirm.pageOf': '{n} / {total}',
  'confirm.start': 'Start processing',
  'processing.pagesAll': 'All {n} pages',

  // P05 处理中
  'processing.title': 'Processing',
  'processing.recognizing': 'Recognizing tables…',
  'processing.step.UPLOADED': 'Uploaded',
  'processing.step.PREPROCESSING': 'Preprocessing',
  'processing.step.PROCESSING': 'Processing',
  'processing.step.POSTPROCESSING': 'Post-processing',
  'processing.info': 'You can leave this page — the task keeps running in the background. Track it in History.',
  'processing.backHome': 'Back to home',
  'processing.cancelTask': 'Cancel task',
  'processing.cancelConfirm': 'Cancel this task?',
  'processing.cancelConfirmBody': 'Recognition will stop and this task will be marked as failed. You can rerun it later.',
  'processing.keepRunning': 'Keep processing',

  // P06 结果详情
  'result.tabOriginal': 'Original',
  'result.tabJson': 'JSON',
  'result.tabTable': 'Table',
  'result.documentInfo': 'Document information',
  'result.noTables': 'No structured data found',
  'result.copyJson': 'Copy',
  'result.copied': 'Copied',
  'result.copyFailed': 'Copy failed',
  'result.updatedAt': 'Updated {time}',
  'result.meta': '{pages} pages · {tables} tables',
  'result.original': 'Original document',
  'result.tapZoom': 'Tap to zoom',
  'viewer.hint': 'Pinch or double-tap to zoom · drag to move',
  'viewer.zoomIn': 'Zoom in',
  'viewer.zoomOut': 'Zoom out',
  'viewer.reset': 'Reset zoom',
  'viewer.prev': 'Previous page',
  'viewer.next': 'Next page',
  'viewer.loadFailed': 'Unable to load this page',
  'result.documentTables': 'Tables',
  'result.editHint': 'Review and edit the parsed values, then confirm.',
  'result.lockedHint': 'This result is confirmed and can no longer be edited.',
  'result.guestHint': 'Sign in or register before confirming. An active plan is required to continue.',
  'result.saving': 'Saving…',
  'result.continue': 'Continue',
  'result.failedTitle': 'Processing failed',
  'result.cancelledTitle': 'Processing cancelled',
  'result.retry': 'Retry',
  'result.retrying': 'Retrying…',

  // P09 最终结果
  'final.title': 'Final result',
  'final.exportExcel': 'Export Excel',
  'final.exporting': 'Preparing Excel…',
  'final.exportReady': 'Excel export ready',
  'final.newScan': 'New scan',

  // P07 历史
  'history.title': 'History',
  'history.searchPlaceholder': 'Search file name',
  'history.filter.all': 'All',
  'history.empty': 'No tasks yet',
  'history.loadingMore': 'Loading more…',
  'history.noMore': 'No more records',

  // P08 我的
  'my.title': 'My account',
  'my.lineConnected': 'LINE account connected',
  'my.company': 'My company',
  'my.companyEmpty': 'No verified company yet',
  'my.language': 'Language',
  'my.logout': 'Sign out',
  'my.loggingOut': 'Signing out…',
  'my.logoutConfirmTitle': 'Sign out?',
  'my.logoutConfirmBody': 'You will need to sign in with LINE again to use your account.',
  'my.companyManage': 'Manage companies',
  'my.identity': 'Acting as',
  'my.plans': 'Plans & pricing',
  'my.guest': 'Guest',
  'my.guestHint': 'Sign in or register to save your results and export.',
  'my.loginOrRegister': 'Sign in / Register',

  // 注册信息录入 / 个人资料（FR-SYS-014/015/016）
  'register.title': 'Complete your profile',
  'register.subtitle': 'We filled in what LINE shared with us. Check it and finish registration.',
  'register.fromLineLocked': 'From your LINE account · cannot be changed',
  'register.fromLineEditable': 'From your LINE account · you can change it',
  'register.emailMissing': 'LINE did not share an email — please enter one.',
  'register.submit': 'Register',
  'register.submitting': 'Registering…',
  'profile.edit': 'Edit',
  'profile.editTitle': 'Edit profile',
  'profile.changeAvatar': 'Change photo',
  'profile.avatarInvalid': 'Please choose a JPG, PNG or WebP image.',
  'profile.phone': 'Phone',
  'profile.phoneMissing': 'Not provided by LINE',
  'profile.email': 'Email',
  'profile.emailNotSet': 'Not set',
  'profile.emailPlaceholder': 'name@example.com',
  'profile.emailRequired': 'Email is required',
  'profile.nickname': 'Nickname',
  'profile.nicknameRequired': 'Nickname is required',
  'profile.save': 'Save',
  'profile.saving': 'Saving…',
  'profile.changeEmail': 'Change',
  'profile.changeEmailTitle': 'Change email',
  'profile.currentEmail': 'Current email',
  'profile.newEmail': 'New email',
  'profile.sendCode': 'Send code',
  'profile.resendCode': 'Resend',
  'profile.resendIn': 'Resend ({n}s)',
  'profile.codeSent': 'A verification code was sent to {email}.',
  'profile.codeResendNeeded': 'Email changed — send a code to the new address.',
  'profile.code': 'Verification code',
  'profile.codePlaceholder': '6-digit code',
  'profile.codeRequired': 'Verification code is required',
  'profile.codeSendFirst': 'Send a code to this email first',
  'profile.confirmChange': 'Confirm',

  // P15 套餐与定价（PRD v1.4 §20，THB 线下支付）
  'plans.title': 'Plans & pricing',
  'plans.current': 'Current plan',
  'plans.freePlan': 'Free',
  'plans.personalWorkspace': 'Personal workspace',
  'plans.enterpriseWorkspace': 'Company workspace',
  'plans.packages': 'PACKAGES · THB',
  'plans.seats': '{n} users',
  'plans.seat': '1 user',
  'plans.pagesPerMonth': '{n} pages / mo',
  'plans.contactToBuy': 'Contact to buy',
  'plans.getQuote': 'Get a quote',
  'plans.offlineTitle': 'Payments are handled offline.',
  'plans.offlineBody': 'Contact our sales team on LINE to activate or renew a plan.',
  'plans.footnote': 'All plans include OCR + Excel export · TH / EN documents',
  'plans.footer': 'saiflow by Alibaba',
  'plans.checkTitle': 'Check subscription',
  'plans.checkHint': 'Your result is confirmed. Choose a plan and submit an upgrade request — our sales team will contact you to activate it offline.',
  'plans.selected': 'Selected',
  'plans.upgradeTo': 'Upgrade to {plan}',
  'plans.submitting': 'Submitting…',
  'plans.receivedTitle': 'Request received',
  'plans.receivedBody': 'Your application has been received. We will contact you as soon as possible.',
  'plans.receivedOk': 'OK',
  'plans.ownerOnly': 'This company plan is shared by all members. Only the company owner can request an upgrade.',
  'err.plan.enterprise_owner_only': 'Only the company owner can upgrade the company plan.',
  'planPending.title': 'Plan upgrade',
  'planPending.heading': 'Plan upgrade in progress',
  'planPending.body': 'Your upgrade request is being processed. Our sales team will contact you on LINE to complete activation.',
  'planPending.plan': 'Requested plan',
  'planPending.submittedAt': 'Submitted',
  'planPending.home': 'Back to home',
  'err.plan.application_pending': 'Your plan upgrade request is already being processed.',
  'err.plan.not_upgrade': 'Please choose a plan higher than your current plan.',
  'plans.currentActive': 'Active',
  'plans.upgrade': 'Upgrade',
  'plans.upgradePending': 'Upgrade in progress',
  'plans.confirmTitle': 'Confirm upgrade',
  'plans.confirmBody': 'Submit a request to upgrade to {plan}? Our sales team will contact you to complete payment offline.',
  'plans.confirmOk': 'Confirm',
  'plans.pendingNotice': 'Our sales team will contact you soon to complete payment and activation.',
  'plans.pendingTitle': 'Upgrade to {plan} in progress',
  'plans.pagesLeft': '{left} / {total} pages left this month',
  'plans.freeScansLeft': '{left} / {total} free scans left',
  'plans.inReview': 'IN REVIEW',

  // 企业（添加/编辑/编号绑定/解绑，后台人工审核 enterprises.status）
  'company.title': 'Company',
  'company.bindTitle': 'Join a company',
  'company.bindHint': 'Enter the company code (shown on the company card) to join it.',
  'company.bindPlaceholder': 'Company code',
  'company.bind': 'Join',
  'company.bindSuccess': 'Joined',
  'company.bindErrorId': 'Enter a valid company code',
  'company.myCompanies': 'My companies',
  'company.add': '＋ Add company',
  'company.empty': 'No company yet — add one to work as a company.',
  'company.edit': 'Edit',
  'company.unbind': 'Leave',
  'company.unbindConfirm': 'Leave this company?',
  'company.addTitle': 'Add company',
  'company.editTitle': 'Edit company',
  'company.editResets': 'Editing a verified company sends it back to manual review before it takes effect again.',
  'company.legalName': 'Company name',
  'company.regNo': 'Company code',
  'company.contactPhone': 'Contact phone',
  'company.certPhoto': 'Certificate photo',
  'company.certPick': 'Choose photo',
  'company.certChange': 'Change photo',
  'company.certUploading': 'Uploading…',
  'company.certHint': 'Business registration certificate — JPG/PNG/PDF.',
  'company.save': 'Save changes',
  'company.submit': 'Submit for review',
  'company.submitting': 'Submitting…',
  'company.reviewHint': 'New and edited companies are reviewed manually by the platform before taking effect. The company number is generated automatically.',
  'company.bonusHint': 'Verification bonus: 1,000 free scans credited to company workspace',
  'company.status.PENDING_VERIFICATION': 'Under review',
  'company.status.VERIFIED': 'Verified',
  'company.status.SUSPENDED': 'Suspended',
  'company.status.DISABLED': 'Disabled',
  'company.error.required': 'This field is required',
  'company.error.phone': 'Too long (max 32 characters)',

  // 导出
  'export.creating': 'Preparing export…',
  'export.ready': 'Export ready',
  'export.failed': 'Export failed',

  // 后端 message_key → 用户文案（error 兜底在 err.*）
  'err.auth.login_required': 'Please sign in',
  'err.auth.session_expired': 'Session expired, please sign in again',
  'err.auth.session_revoked': 'Session revoked, please sign in again',
  'err.auth.account_disabled': 'Account disabled',
  'err.auth.line_token_invalid': 'LINE sign-in failed, please try again',
  'err.auth.line_token_expired': 'LINE sign-in expired, please try again',
  'err.auth.line_not_configured': 'LINE login is not available',
  'err.auth.line_init_failed': 'Could not reach LINE. Please try again.',
  'err.error.csrf_invalid': 'Security token expired, please retry',
  'err.error.not_found': 'Not found or no access',
  'err.error.permission_denied': 'No permission',
  'err.error.state_conflict': 'Status changed, please refresh',
  'err.error.version_conflict': 'Someone else edited this, please refresh',
  'err.error.rate_limited': 'Too many requests, please wait',
  'err.error.network': 'Cannot reach the server. Please check your connection and try again.',
  'err.error.invalid_argument': 'Invalid input',
  'err.error.field_required': 'This field is required',
  'err.error.email_invalid': 'Please enter a valid email address',
  'err.error.email_unchanged': 'This is already your email',
  'err.error.email_code_invalid': 'Verification code is wrong or expired',
  'err.error.avatar_invalid': 'Please choose a JPG, PNG or WebP image under 300 KB.',
  'err.avatar.upload_failed': 'Could not save your photo. Please try again later.',
  'err.registration.already_done': 'Registration is already complete',
  'err.email.sender_unavailable': 'Email service is not available right now',
  'err.files.unsupported_type': 'Unsupported file type',
  'err.files.too_large': 'File too large',
  'err.files.too_many_pages': 'Too many pages',
  'err.files.disguised_type': 'File content does not match its extension',
  'err.files.corrupt_or_encrypted': 'PDF is corrupt or encrypted',
  'err.file_import.invalid_url': 'Invalid URL',
  'err.file_import.fetch_failed': 'Failed to fetch the file',
  'err.job.file_not_ready': 'File is not ready yet',
  'err.job.page_out_of_range': 'Page out of range',
  'err.job.page_count_exceeded': 'Too many pages selected',
  'err.job.already_terminal': 'Task already finished',
  'err.job.not_terminal': 'Task is still running',
  'err.ocr.failed': 'Image parsing failed. Please retry or upload the document again.',
  'err.ocr.vendor_balance': 'OCR service balance is insufficient. Please top up the TextIn account or update its credentials, then retry.',
  'err.export.expired': 'Export expired, please export again',
  'err.application.duplicate_open': 'You already have an open application',
  'err.application.not_open': 'Application is already decided',
  'err.membership.rejoin_forbidden': 'Cannot re-apply to this company',
  'err.membership.already_member': 'Already a member of this company',
  'err.quota.exceeded': 'Free scan quota used up — contact sales to activate a plan',
};

const th: Dict = {
  // 通用
  'common.loading': 'กำลังโหลด…',
  'common.retry': 'ลองอีกครั้ง',
  'common.cancel': 'ยกเลิก',
  'common.save': 'บันทึก',
  'common.confirm': 'ยืนยัน',
  'common.delete': 'ลบ',
  'common.done': 'เสร็จสิ้น',
  'common.back': 'ย้อนกลับ',
  'common.unknownError': 'ข้อผิดพลาดที่ไม่ทราบสาเหตุ',
  'common.search': 'ค้นหา',
  'common.empty': 'ยังไม่มีข้อมูล',
  'common.close': 'ปิด',

  // P01 启动页
  'boot.connecting': 'กำลังเชื่อมต่อ LINE…',
  'boot.poweredBy': 'ขับเคลื่อนโดย LINE MINI App',

  // 登录
  'login.withLine': 'เข้าสู่ระบบด้วย LINE',
  'login.devTitle': 'เข้าสู่ระบบสำหรับนักพัฒนา',
  'login.devHint': 'โหมดพัฒนา: ปุ่ม LINE ทั้งสองปุ่มจะเข้าสู่ระบบด้วย ID นี้ทันที เปลี่ยน ID เพื่อสร้างบัญชีอื่น',
  'login.devPlaceholder': 'Dev ID',
  'login.devSubmit': 'เข้าสู่ระบบ',
  'login.failed': 'เข้าสู่ระบบไม่สำเร็จ',

  // 登录 / 注册（确认结果后进入）
  'auth.tabLogin': 'เข้าสู่ระบบ',
  'auth.tabRegister': 'สมัครสมาชิก',
  'auth.loginHint': 'เข้าสู่ระบบด้วย LINE เพื่อบันทึกผลลัพธ์นี้และดำเนินการต่อ',
  'auth.registerHint': 'สมัครสมาชิกด้วย LINE — ระบบจะสร้างบัญชีให้อัตโนมัติ',
  'auth.registerWithLine': 'สมัครสมาชิกด้วย LINE',
  'auth.registerNote': 'ไม่ต้องใช้รหัสผ่าน ไฟล์และผลลัพธ์ระหว่างทดลองใช้จะถูกย้ายไปยังบัญชีของคุณ',

  // 底部导航
  'nav.scan': 'SCAN',
  'nav.history': 'HISTORY',
  'nav.my': 'MY',

  // P02 扫描主页
  'home.recent': 'งานล่าสุด',
  'home.importUrl': 'นำเข้าจาก URL',
  'home.urlPlaceholder': 'https://example.com/invoice.pdf',
  'home.urlSubmit': 'นำเข้า',
  'home.camera': 'กล้อง',
  'home.photos': 'รูปภาพ',
  'home.files': 'ไฟล์',
  'home.pickHint': 'JPG / PNG / PDF ไม่เกิน {size}MB',
  'home.workspacePersonal': 'ส่วนตัว',
  'home.uploading': 'กำลังอัปโหลด… {pct}%',
  'home.quotaLeft': '{plan} · เหลือฟรี {left} / {total} ครั้ง',
  'home.quotaLeftPaid': '{plan} · เหลือ {left} / {total} หน้าในเดือนนี้',
  'home.plansLink': 'แพ็กเกจ ›',
  'home.freeBadge': 'โบนัสสมัครใหม่',

  // 任务流程阶段
  'job.stage.OCR_PROCESSING': 'กำลังประมวลผล OCR',
  'job.stage.OCR_FAILED': 'OCR ล้มเหลว',
  'job.stage.VERIFYING': 'กำลังตรวจสอบข้อมูล',
  'job.stage.VERIFIED': 'ตรวจสอบข้อมูลแล้ว',
  'job.stage.COMPLETED': 'เสร็จสมบูรณ์',
  'job.review.UNREVIEWED': 'ยังไม่ตรวจสอบ',
  'job.review.EDITED': 'แก้ไขแล้ว',
  'job.review.CONFIRMED': 'ยืนยันแล้ว',

  // P03 确认文档
  'confirm.title': 'ยืนยันเอกสาร',
  'confirm.pageOf': '{n} / {total}',
  'confirm.start': 'เริ่มประมวลผล',
  'processing.pagesAll': 'ทั้งหมด {n} หน้า',

  // P05 处理中
  'processing.title': 'กำลังประมวลผล',
  'processing.recognizing': 'กำลังจดจำตาราง…',
  'processing.step.UPLOADED': 'อัปโหลดแล้ว',
  'processing.step.PREPROCESSING': 'เตรียมข้อมูล',
  'processing.step.PROCESSING': 'ประมวลผล',
  'processing.step.POSTPROCESSING': 'หลังประมวลผล',
  'processing.info': 'คุณสามารถออกจากหน้านี้ได้ งานจะยังคงทำงานต่อในเบื้องหลัง ติดตามได้ในประวัติ',
  'processing.backHome': 'กลับหน้าหลัก',
  'processing.cancelTask': 'ยกเลิกงาน',
  'processing.cancelConfirm': 'ยกเลิกงานนี้หรือไม่?',
  'processing.cancelConfirmBody': 'การจดจำจะหยุดลงและงานนี้จะถูกทำเครื่องหมายว่าล้มเหลว คุณสามารถเรียกใช้ใหม่ได้ภายหลัง',
  'processing.keepRunning': 'ประมวลผลต่อ',

  // P06 结果详情
  'result.tabOriginal': 'ต้นฉบับ',
  'result.tabJson': 'JSON',
  'result.tabTable': 'ตาราง',
  'result.documentInfo': 'ข้อมูลเอกสาร',
  'result.noTables': 'ไม่พบข้อมูลที่มีโครงสร้าง',
  'result.copyJson': 'คัดลอก',
  'result.copied': 'คัดลอกแล้ว',
  'result.copyFailed': 'คัดลอกไม่สำเร็จ',
  'result.updatedAt': 'อัปเดต {time}',
  'result.meta': '{pages} หน้า · {tables} ตาราง',
  'result.original': 'เอกสารต้นฉบับ',
  'result.tapZoom': 'แตะเพื่อขยาย',
  'viewer.hint': 'ใช้สองนิ้วหรือแตะสองครั้งเพื่อซูม · ลากเพื่อเลื่อน',
  'viewer.zoomIn': 'ซูมเข้า',
  'viewer.zoomOut': 'ซูมออก',
  'viewer.reset': 'รีเซ็ตการซูม',
  'viewer.prev': 'หน้าก่อนหน้า',
  'viewer.next': 'หน้าถัดไป',
  'viewer.loadFailed': 'ไม่สามารถโหลดหน้านี้ได้',
  'result.documentTables': 'ตารางข้อมูล',
  'result.editHint': 'ตรวจสอบและแก้ไขค่าที่วิเคราะห์ได้ แล้วกดยืนยัน',
  'result.lockedHint': 'ผลลัพธ์นี้ยืนยันแล้ว ไม่สามารถแก้ไขได้',
  'result.guestHint': 'เข้าสู่ระบบหรือสมัครสมาชิกก่อนยืนยัน และเปิดใช้งานแพ็กเกจเพื่อดำเนินการต่อ',
  'result.saving': 'กำลังบันทึก…',
  'result.continue': 'ดำเนินการต่อ',
  'result.failedTitle': 'ประมวลผลไม่สำเร็จ',
  'result.cancelledTitle': 'ยกเลิกการประมวลผล',
  'result.retry': 'ลองอีกครั้ง',
  'result.retrying': 'กำลังลองใหม่…',

  // P09 最终结果
  'final.title': 'ผลลัพธ์สุดท้าย',
  'final.exportExcel': 'ส่งออก Excel',
  'final.exporting': 'กำลังเตรียม Excel…',
  'final.exportReady': 'ไฟล์ Excel พร้อมแล้ว',
  'final.newScan': 'สแกนใหม่',

  // P07 历史
  'history.title': 'ประวัติ',
  'history.searchPlaceholder': 'ค้นหาชื่อไฟล์',
  'history.filter.all': 'ทั้งหมด',
  'history.empty': 'ยังไม่มีงาน',
  'history.loadingMore': 'กำลังโหลดเพิ่มเติม…',
  'history.noMore': 'ไม่มีรายการเพิ่มเติม',

  // P08 我的
  'my.title': 'บัญชีของฉัน',
  'my.lineConnected': 'เชื่อมต่อบัญชี LINE แล้ว',
  'my.company': 'บริษัทของฉัน',
  'my.companyEmpty': 'ยังไม่มีบริษัทที่ยืนยันแล้ว',
  'my.language': 'ภาษา',
  'my.logout': 'ออกจากระบบ',
  'my.loggingOut': 'กำลังออกจากระบบ…',
  'my.logoutConfirmTitle': 'ออกจากระบบ?',
  'my.logoutConfirmBody': 'คุณจะต้องเข้าสู่ระบบด้วย LINE อีกครั้งเพื่อใช้งานบัญชีของคุณ',
  'my.companyManage': 'จัดการบริษัท',
  'my.identity': 'ทำงานในนาม',
  'my.plans': 'แพ็กเกจและราคา',
  'my.guest': 'ผู้เยี่ยมชม',
  'my.guestHint': 'เข้าสู่ระบบหรือสมัครสมาชิกเพื่อบันทึกผลลัพธ์และส่งออก',
  'my.loginOrRegister': 'เข้าสู่ระบบ / สมัครสมาชิก',

  'register.title': 'กรอกข้อมูลโปรไฟล์ให้ครบ',
  'register.subtitle': 'เราใส่ข้อมูลที่ได้จาก LINE ไว้ให้แล้ว ตรวจสอบแล้วลงทะเบียนให้เสร็จ',
  'register.fromLineLocked': 'จากบัญชี LINE · แก้ไขไม่ได้',
  'register.fromLineEditable': 'จากบัญชี LINE · แก้ไขได้',
  'register.emailMissing': 'LINE ไม่ได้ให้อีเมล กรุณากรอกอีเมล',
  'register.submit': 'ลงทะเบียน',
  'register.submitting': 'กำลังลงทะเบียน…',
  'profile.edit': 'แก้ไข',
  'profile.editTitle': 'แก้ไขโปรไฟล์',
  'profile.changeAvatar': 'เปลี่ยนรูป',
  'profile.avatarInvalid': 'กรุณาเลือกรูป JPG, PNG หรือ WebP',
  'profile.phone': 'เบอร์โทร',
  'profile.phoneMissing': 'LINE ไม่ได้ให้ข้อมูล',
  'profile.email': 'อีเมล',
  'profile.emailNotSet': 'ยังไม่ได้ตั้งค่า',
  'profile.emailPlaceholder': 'name@example.com',
  'profile.emailRequired': 'กรุณากรอกอีเมล',
  'profile.nickname': 'ชื่อเล่น',
  'profile.nicknameRequired': 'กรุณากรอกชื่อเล่น',
  'profile.save': 'บันทึก',
  'profile.saving': 'กำลังบันทึก…',
  'profile.changeEmail': 'เปลี่ยน',
  'profile.changeEmailTitle': 'เปลี่ยนอีเมล',
  'profile.currentEmail': 'อีเมลปัจจุบัน',
  'profile.newEmail': 'อีเมลใหม่',
  'profile.sendCode': 'ส่งรหัส',
  'profile.resendCode': 'ส่งอีกครั้ง',
  'profile.resendIn': 'ส่งอีกครั้ง ({n} วิ)',
  'profile.codeSent': 'ส่งรหัสยืนยันไปที่ {email} แล้ว',
  'profile.codeResendNeeded': 'อีเมลเปลี่ยนแล้ว กรุณาส่งรหัสไปยังอีเมลใหม่',
  'profile.code': 'รหัสยืนยัน',
  'profile.codePlaceholder': 'รหัส 6 หลัก',
  'profile.codeRequired': 'กรุณากรอกรหัสยืนยัน',
  'profile.codeSendFirst': 'กรุณาส่งรหัสไปยังอีเมลนี้ก่อน',
  'profile.confirmChange': 'ยืนยัน',

  // P15 套餐与定价
  'plans.title': 'แพ็กเกจและราคา',
  'plans.current': 'แพ็กเกจปัจจุบัน',
  'plans.freePlan': 'ฟรี',
  'plans.personalWorkspace': 'พื้นที่ส่วนตัว',
  'plans.enterpriseWorkspace': 'พื้นที่บริษัท',
  'plans.packages': 'แพ็กเกจ · THB',
  'plans.seats': '{n} ผู้ใช้',
  'plans.seat': '1 ผู้ใช้',
  'plans.pagesPerMonth': '{n} หน้า / เดือน',
  'plans.contactToBuy': 'ติดต่อเพื่อซื้อ',
  'plans.getQuote': 'ขอใบเสนอราคา',
  'plans.offlineTitle': 'ชำระเงินแบบออฟไลน์',
  'plans.offlineBody': 'ติดต่อทีมขายของเราทาง LINE เพื่อเปิดใช้งานหรือต่ออายุแพ็กเกจ',
  'plans.footnote': 'ทุกแพ็กเกจรวม OCR + ส่งออก Excel · เอกสาร TH / EN',
  'plans.footer': 'saiflow by Alibaba',
  'plans.checkTitle': 'ตรวจสอบแพ็กเกจ',
  'plans.checkHint': 'ผลลัพธ์ของคุณได้รับการยืนยันแล้ว เลือกแพ็กเกจและส่งคำขออัปเกรด — ทีมขายของเราจะติดต่อคุณเพื่อเปิดใช้งานแบบออฟไลน์',
  'plans.selected': 'เลือกแล้ว',
  'plans.upgradeTo': 'อัปเกรดเป็น {plan}',
  'plans.submitting': 'กำลังส่ง…',
  'plans.receivedTitle': 'ได้รับคำขอแล้ว',
  'plans.receivedBody': 'เราได้รับคำขอของคุณแล้ว และจะติดต่อกลับโดยเร็วที่สุด',
  'plans.receivedOk': 'ตกลง',
  'plans.ownerOnly': 'แพ็กเกจของบริษัทใช้ร่วมกันโดยสมาชิกทุกคน เฉพาะเจ้าของบริษัทเท่านั้นที่ขออัปเกรดได้',
  'err.plan.enterprise_owner_only': 'เฉพาะเจ้าของบริษัทเท่านั้นที่อัปเกรดแพ็กเกจของบริษัทได้',
  'planPending.title': 'อัปเกรดแพ็กเกจ',
  'planPending.heading': 'กำลังดำเนินการอัปเกรดแพ็กเกจ',
  'planPending.body': 'คำขออัปเกรดของคุณกำลังดำเนินการ ทีมขายของเราจะติดต่อคุณทาง LINE เพื่อเปิดใช้งาน',
  'planPending.plan': 'แพ็กเกจที่ขอ',
  'planPending.submittedAt': 'ส่งเมื่อ',
  'planPending.home': 'กลับหน้าแรก',
  'err.plan.application_pending': 'คำขออัปเกรดแพ็กเกจของคุณกำลังดำเนินการอยู่',
  'err.plan.not_upgrade': 'กรุณาเลือกแพ็กเกจที่สูงกว่าแพ็กเกจปัจจุบัน',
  'plans.currentActive': 'ใช้งานอยู่',
  'plans.upgrade': 'อัปเกรด',
  'plans.upgradePending': 'กำลังดำเนินการอัปเกรด',
  'plans.confirmTitle': 'ยืนยันการอัปเกรด',
  'plans.confirmBody': 'ส่งคำขออัปเกรดเป็น {plan} หรือไม่? ทีมขายของเราจะติดต่อคุณเพื่อชำระเงินแบบออฟไลน์',
  'plans.confirmOk': 'ยืนยัน',
  'plans.pendingNotice': 'ทีมขายของเราจะติดต่อคุณเร็ว ๆ นี้เพื่อชำระเงินและเปิดใช้งาน',
  'plans.pendingTitle': 'กำลังอัปเกรดเป็น {plan}',
  'plans.pagesLeft': 'เหลือ {left} / {total} หน้าในเดือนนี้',
  'plans.freeScansLeft': 'เหลือฟรี {left} / {total} ครั้ง',
  'plans.inReview': 'กำลังตรวจสอบ',

  // 企业（添加/编辑/编号绑定/解绑，后台人工审核 enterprises.status）
  'company.title': 'บริษัท',
  'company.bindTitle': 'เข้าร่วมบริษัท',
  'company.bindHint': 'กรอกรหัสบริษัท (แสดงบนการ์ดบริษัท) เพื่อเข้าร่วม',
  'company.bindPlaceholder': 'รหัสบริษัท',
  'company.bind': 'เข้าร่วม',
  'company.bindSuccess': 'เข้าร่วมแล้ว',
  'company.bindErrorId': 'กรอกรหัสบริษัทให้ถูกต้อง',
  'company.myCompanies': 'บริษัทของฉัน',
  'company.add': '＋ เพิ่มบริษัท',
  'company.empty': 'ยังไม่มีบริษัท — เพิ่มบริษัทเพื่อทำงานในนามบริษัท',
  'company.edit': 'แก้ไข',
  'company.unbind': 'ออกจากบริษัท',
  'company.unbindConfirm': 'ออกจากบริษัทนี้หรือไม่?',
  'company.addTitle': 'เพิ่มบริษัท',
  'company.editTitle': 'แก้ไขบริษัท',
  'company.editResets': 'การแก้ไขบริษัทที่ยืนยันแล้ว จะกลับไปอยู่ในสถานะรอตรวจสอบอีกครั้งก่อนมีผล',
  'company.legalName': 'ชื่อบริษัท',
  'company.regNo': 'รหัสบริษัท',
  'company.contactPhone': 'โทรศัพท์ผู้ติดต่อ',
  'company.certPhoto': 'รูปเอกสารแนบ',
  'company.certPick': 'เลือกรูป',
  'company.certChange': 'เปลี่ยนรูป',
  'company.certUploading': 'กำลังอัปโหลด…',
  'company.certHint': 'เอกสารจดทะเบียนบริษัท — JPG/PNG/PDF',
  'company.save': 'บันทึกการแก้ไข',
  'company.submit': 'ส่งเพื่อตรวจสอบ',
  'company.submitting': 'กำลังส่ง…',
  'company.reviewHint': 'บริษัทที่เพิ่มหรือแก้ไขใหม่จะถูกตรวจสอบด้วยตนเองโดยแพลตฟอร์มก่อนมีผล หมายเลขบริษัทถูกสร้างอัตโนมัติ',
  'company.bonusHint': 'โบนัสยืนยัน: สแกนฟรี 1,000 ครั้งเข้าพื้นที่ทำงานของบริษัท',
  'company.status.PENDING_VERIFICATION': 'อยู่ระหว่างตรวจสอบ',
  'company.status.VERIFIED': 'ยืนยันแล้ว',
  'company.status.SUSPENDED': 'ถูกระงับ',
  'company.status.DISABLED': 'ปิดใช้งาน',
  'company.error.required': 'จำเป็นต้องกรอกช่องนี้',
  'company.error.phone': 'ยาวเกินไป (สูงสุด 32 ตัวอักษร)',

  // 导出
  'export.creating': 'กำลังเตรียมไฟล์…',
  'export.ready': 'พร้อมส่งออกแล้ว',
  'export.failed': 'ส่งออกไม่สำเร็จ',

  // 后端 message_key → 用户文案
  'err.auth.login_required': 'กรุณาเข้าสู่ระบบ',
  'err.auth.session_expired': 'เซสชันหมดอายุ กรุณาเข้าสู่ระบบอีกครั้ง',
  'err.auth.session_revoked': 'เซสชันถูกยกเลิก กรุณาเข้าสู่ระบบอีกครั้ง',
  'err.auth.account_disabled': 'บัญชีถูกปิดใช้งาน',
  'err.auth.line_token_invalid': 'เข้าสู่ระบบ LINE ไม่สำเร็จ กรุณาลองอีกครั้ง',
  'err.auth.line_token_expired': 'การเข้าสู่ระบบ LINE หมดอายุ กรุณาลองอีกครั้ง',
  'err.auth.line_not_configured': 'ไม่พบการตั้งค่าเข้าสู่ระบบ LINE',
  'err.auth.line_init_failed': 'เชื่อมต่อ LINE ไม่สำเร็จ กรุณาลองอีกครั้ง',
  'err.error.csrf_invalid': 'โทเคนความปลอดภัยหมดอายุ กรุณาลองใหม่',
  'err.error.not_found': 'ไม่พบข้อมูลหรือไม่มีสิทธิ์เข้าถึง',
  'err.error.permission_denied': 'ไม่มีสิทธิ์ดำเนินการ',
  'err.error.state_conflict': 'สถานะเปลี่ยนแปลง กรุณารีเฟรช',
  'err.error.version_conflict': 'มีผู้อื่นแก้ไขข้อมูลนี้ กรุณารีเฟรช',
  'err.error.rate_limited': 'คำขอถี่เกินไป กรุณารอสักครู่',
  'err.error.network': 'เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ กรุณาตรวจสอบเครือข่ายแล้วลองอีกครั้ง',
  'err.error.invalid_argument': 'ข้อมูลไม่ถูกต้อง',
  'err.error.field_required': 'กรุณากรอกช่องนี้',
  'err.error.email_invalid': 'กรุณากรอกอีเมลให้ถูกต้อง',
  'err.error.email_unchanged': 'นี่คืออีเมลปัจจุบันของคุณอยู่แล้ว',
  'err.error.email_code_invalid': 'รหัสยืนยันไม่ถูกต้องหรือหมดอายุ',
  'err.error.avatar_invalid': 'กรุณาเลือกรูป JPG, PNG หรือ WebP ขนาดไม่เกิน 300 KB',
  'err.avatar.upload_failed': 'บันทึกรูปโปรไฟล์ไม่สำเร็จ กรุณาลองใหม่ภายหลัง',
  'err.registration.already_done': 'ลงทะเบียนเรียบร้อยแล้ว',
  'err.email.sender_unavailable': 'บริการอีเมลยังไม่พร้อมใช้งาน',
  'err.files.unsupported_type': 'ประเภทไฟล์ไม่รองรับ',
  'err.files.too_large': 'ไฟล์ใหญ่เกินไป',
  'err.files.too_many_pages': 'จำนวนหน้าเกินกำหนด',
  'err.files.disguised_type': 'เนื้อหาไฟล์ไม่ตรงกับนามสกุล',
  'err.files.corrupt_or_encrypted': 'ไฟล์ PDF เสียหรือถูกเข้ารหัส',
  'err.file_import.invalid_url': 'URL ไม่ถูกต้อง',
  'err.file_import.fetch_failed': 'ดึงไฟล์ไม่สำเร็จ',
  'err.job.file_not_ready': 'ไฟล์ยังไม่พร้อม',
  'err.job.page_out_of_range': 'เลขหน้าเกินขอบเขต',
  'err.job.page_count_exceeded': 'จำนวนหน้าที่เลือกเกินกำหนด',
  'err.job.already_terminal': 'งานนี้จบไปแล้ว',
  'err.job.not_terminal': 'งานยังทำงานอยู่',
  'err.ocr.failed': 'วิเคราะห์รูปภาพไม่สำเร็จ กรุณาลองอีกครั้งหรืออัปโหลดเอกสารใหม่',
  'err.ocr.vendor_balance': 'เครดิตบริการ OCR ไม่เพียงพอ กรุณาเติมเงินบัญชี TextIn หรืออัปเดตข้อมูลรับรอง แล้วลองอีกครั้ง',
  'err.export.expired': 'ไฟล์ส่งออกหมดอายุ กรุณาส่งออกใหม่',
  'err.application.duplicate_open': 'คุณมีคำขอที่เปิดอยู่แล้ว',
  'err.application.not_open': 'คำขอถูกตัดสินไปแล้ว',
  'err.membership.rejoin_forbidden': 'ไม่สามารถสมัครเข้าบริษัทนี้ใหม่ได้',
  'err.membership.already_member': 'เป็นสมาชิกบริษัทนี้อยู่แล้ว',
  'err.quota.exceeded': 'โควตาฟรีหมดแล้ว — ติดต่อฝ่ายขายเพื่อเปิดแพ็กเกจ',
};

const dicts: Record<Locale, Dict> = { en, th };

/** 翻译：t('home.recent') / t('confirm.pageOf', { n: 1, total: 8 }) */
export function t(key: string, params?: Params): string {
  const dict = dicts[current];
  let s = dict[key] ?? en[key] ?? key;
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      s = s.split(`{${k}}`).join(String(v));
    }
  }
  return s;
}

/** 后端 message_key → 本地文案（带 err. 前缀查表，缺失时兜底通用错误） */
export function messageText(messageKey: string): string {
  return t(`err.${messageKey}`) !== `err.${messageKey}` ? t(`err.${messageKey}`) : t('common.unknownError');
}
