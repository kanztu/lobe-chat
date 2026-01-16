import { useTranslation } from 'react-i18next';

import SettingHeader from '@/app/[variants]/(main)/settings/features/SettingHeader';
import { BackupExportSection } from '@/features/Settings/features/BackupExport';

import Advanced from './features/Advanced';

const Page = () => {
  const { t } = useTranslation('setting');
  return (
    <>
      <SettingHeader title={t('tab.storage')} />
      <BackupExportSection />
      <Advanced />
    </>
  );
};

export default Page;
