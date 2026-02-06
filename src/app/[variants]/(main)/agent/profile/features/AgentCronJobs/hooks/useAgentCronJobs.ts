import { message } from 'antd';
import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import useSWR from 'swr';

import type {
  CreateAgentCronJobData,
  UpdateAgentCronJobData,
} from '@/database/schemas/agentCronJob';
import { agentCronJobService } from '@/services/agentCronJob';

const EMPTY_RESPONSE = { data: [] as any[], success: true } as const;

export const useAgentCronJobs = (agentId?: string, enabled: boolean = true) => {
  const { t } = useTranslation('setting');

  // Fetch cron jobs for the agent
  const {
    data: cronJobs,
    error,
    isLoading: loading,
    mutate,
  } = useSWR(
    enabled && agentId ? `/api/agent-cron-jobs/${agentId}` : null,
    enabled && agentId ? () => agentCronJobService.getByAgentId(agentId) : null,
    {
      onError: (error) => {
        console.error('Failed to fetch cron jobs:', error);
        message.error(t('agentCronJobs.loadFailed' as any));
      },
    },
  );

  // Create a new cron job
  const createCronJob = useCallback(
    async (data: Omit<CreateAgentCronJobData, 'userId'>) => {
      if (!agentId) return;

      try {
        const result = await mutate(
          async (currentData) => {
            await agentCronJobService.create({
              ...data,
              agentId,
            });
            message.success(t('agentCronJobs.createSuccess'));
            return currentData;
          },
          {
            revalidate: true,
          },
        );

        return result?.data;
      } catch (error) {
        console.error('Failed to create cron job:', error);
        message.error(t('agentCronJobs.createFailed' as any));
        throw error;
      }
    },
    [agentId, mutate, t],
  );

  // Update a cron job
  const updateCronJob = useCallback(
    async (id: string, data: UpdateAgentCronJobData) => {
      try {
        await mutate(
          async (currentData) => {
            await agentCronJobService.update(id, data);
            message.success(t('agentCronJobs.updateSuccess'));
            return currentData;
          },
          {
            optimisticData: (currentData) => {
              if (!currentData?.data) return currentData ?? EMPTY_RESPONSE;

              return {
                ...currentData,
                data: currentData.data.map((job) =>
                  job.id === id ? { ...job, ...data } : job
                ),
              };
            },
            revalidate: true,
            rollbackOnError: true,
          },
        );
      } catch (error) {
        console.error('Failed to update cron job:', error);
        message.error(t('agentCronJobs.updateFailed' as any));
        throw error;
      }
    },
    [mutate, t],
  );

  // Delete a cron job
  const deleteCronJob = useCallback(
    async (id: string) => {
      try {
        await mutate(
          async (currentData) => {
            await agentCronJobService.delete(id);
            message.success(t('agentCronJobs.deleteSuccess'));
            return currentData;
          },
          {
            optimisticData: (currentData) => {
              if (!currentData?.data) return currentData ?? EMPTY_RESPONSE;

              return {
                ...currentData,
                data: currentData.data.filter((job) => job.id !== id),
              };
            },
            revalidate: true,
            rollbackOnError: true,
          },
        );
      } catch (error) {
        console.error('Failed to delete cron job:', error);
        message.error(t('agentCronJobs.deleteFailed' as any));
        throw error;
      }
    },
    [mutate, t],
  );

  // Get execution statistics
  const getStats = useCallback(async () => {
    try {
      return await agentCronJobService.getStats();
    } catch (error) {
      console.error('Failed to get cron job stats:', error);
      throw error;
    }
  }, []);

  // Reset execution counts
  const resetExecutions = useCallback(
    async (id: string, newMaxExecutions?: number) => {
      try {
        await mutate(
          async (currentData) => {
            await agentCronJobService.resetExecutions(id, newMaxExecutions);
            message.success(t('agentCronJobs.resetSuccess' as any));
            return currentData;
          },
          {
            optimisticData: (currentData) => {
              if (!currentData?.data) return currentData ?? EMPTY_RESPONSE;

              return {
                ...currentData,
                data: currentData.data.map((job) =>
                  job.id === id
                    ? {
                        ...job,
                        maxExecutions: newMaxExecutions || job.maxExecutions,
                        remainingExecutions: newMaxExecutions || job.maxExecutions,
                      }
                    : job
                ),
              };
            },
            revalidate: true,
            rollbackOnError: true,
          },
        );
      } catch (error) {
        console.error('Failed to reset executions:', error);
        message.error(t('agentCronJobs.resetFailed' as any));
        throw error;
      }
    },
    [mutate, t],
  );

  return {
    createCronJob,
    cronJobs: cronJobs?.data || [],
    deleteCronJob,
    error,
    getStats,
    loading,
    refetch: mutate,
    resetExecutions,
    updateCronJob,
  };
};
