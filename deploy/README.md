# راهنمای مهاجرت سرویس‌های سرور (Carno -> Khodrekab Systemd Migration)

برای مهاجرت به سرویس‌های جدید در سرور لینوکس پروداکشن، مراحل زیر را اجرا کنید:

```bash
# ۱. کپی فایل‌های سرویس جدید به پوشه systemd
sudo cp deploy/khodrekab-*.service /etc/systemd/system/
sudo cp deploy/khodrekab-*.timer /etc/systemd/system/

# ۲. غیرفعال‌سازی سرویس‌های قدیمی
sudo systemctl stop carno-sms-worker.service carno-maintenance.timer 2>/dev/null || true
sudo systemctl disable carno-sms-worker.service carno-maintenance.timer 2>/dev/null || true

# ۳. ریلود دیمن و فعال‌سازی سرویس‌های جدید
sudo systemctl daemon-reload
sudo systemctl enable --now khodrekab-sms-worker.service
sudo systemctl enable --now khodrekab-maintenance.timer

# ۴. بررسی وضعیت
sudo systemctl status khodrekab-sms-worker.service
sudo systemctl status khodrekab-maintenance.timer
```
