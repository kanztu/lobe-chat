import { message } from 'antd';
import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import useSWR from 'swr';

import type {
  CreateAgentCronJobData,
  UpdateAgentCronJobData,
} from '@/database/schemas/agentCronJob';
import { agentCronJobService } from '@/services/agentCronJob';

export const useAgentCronJobs = (agentId?: string) => {
  const { t } = useTranslation('setting');

  // Fetch cron jobs for the agent
  const {
    data: cronJobs,
    error,
    isLoading: loading,
    mutate,
  } = useSWR(
    agentId ? `/api/agent-cron-jobs/${agentId}` : null,
    agentId ? () => agentCronJobService.getByAgentId(agentId) : null,
    {
      onError: (error) => {
        console.error('Failed to fetch cron jobs:', error);
        message.error('Failed to load scheduled tasks');
      },
    },
  );

  // Create a new cron job
  const createCronJob = useCallback(
    async (data: Omit<CreateAgentCronJobData, 'userId'>) => {
      if (!agentId) return;

      try {
        // Optimistic update: immediately add to UI before server response
        const result = await mutate(
          async () => {
            // Create on server
            const result = await agentCronJobService.create({
              ...data,
              agentId,
            });

            if (result.success) {
              message.success(t('agentCronJobs.createSuccess'));
              return result; // Return new data from server
            }
            throw new Error('Failed to create');
          },
          {
            // Revalidate after creation to get server-generated fields
            revalidate: true,
          },
        );

        return result?.data;
      } catch (error) {
        console.error('Failed to create cron job:', error);
        message.error('Failed to create scheduled task');
        throw error;
      }
    },
    [agentId, mutate, t],
  );

  // Update a cron job
  const updateCronJob = useCallback(
    async (id: string, data: UpdateAgentCronJobData) => {
      try {
        // Optimistic update: immediately update UI before server response
        await mutate(
          async (currentData) => {
            // Update the server
            const result = await agentCronJobService.update(id, data);

            if (result.success) {
              message.success(t('agentCronJobs.updateSuccess'));
              return result; // Return new data from server
            }
            return currentData; // Rollback on failure
          },
          {
            // Optimistically update the UI immediately
            optimisticData: (currentData) => {
              if (!currentData?.data) return currentData;

              return {
                ...currentData,
                data: currentData.data.map((job) =>
                  job.id === id ? { ...job, ...data } : job
                ),
              };
            },
            // Don't revalidate after mutation completes (data is already fresh)
            revalidate: false,
            // Rollback on error
            rollbackOnError: true,
          },
        );
      } catch (error) {
        console.error('Failed to update cron job:', error);
        message.error('Failed to update scheduled task');
        throw error;
      }
    },
    [mutate, t],
  );

  // Delete a cron job
  const deleteCronJob = useCallback(
    async (id: string) => {
      try {
        // Optimistic update: immediately remove from UI before server response
        await mutate(
          async (currentData) => {
            // Delete from server
            const result = await agentCronJobService.delete(id);

            if (result.success) {
              message.success(t('agentCronJobs.deleteSuccess'));
              return result; // Return new data from server
            }
            return currentData; // Rollback on failure
          },
          {
            // Optimistically remove from UI immediately
            optimisticData: (currentData) => {
              if (!currentData?.data) return currentData;

              return {
                ...currentData,
                data: currentData.data.filter((job) => job.id !== id),
              };
            },
            // Don't revalidate after mutation completes
            revalidate: false,
            // Rollback on error
            rollbackOnError: true,
          },
        );
      } catch (error) {
        console.error('Failed to delete cron job:', error);
        message.error('Failed to delete scheduled task');
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
        // Optimistic update: immediately update execution counts in UI
        await mutate(
          async (currentData) => {
            // Reset on server
            const result = await agentCronJobService.resetExecutions(id, newMaxExecutions);

            if (result.success) {
              message.success('Execution counts reset successfully');
              return result; // Return new data from server
            }
            return currentData; // Rollback on failure
          },
          {
            // Optimistically update the UI immediately
            optimisticData: (currentData) => {
              if (!currentData?.data) return currentData;

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
            // Don't revalidate after mutation completes
            revalidate: false,
            // Rollback on error
            rollbackOnError: true,
          },
        );
      } catch (error) {
        console.error('Failed to reset executions:', error);
        message.error('Failed to reset execution counts');
        throw error;
      }
    },
    [mutate],
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
