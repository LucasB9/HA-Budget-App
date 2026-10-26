import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from '@tanstack/react-query';
import type {
  BalanceDto,
  DashboardDto,
  ExpenseDto,
  GroupDto,
  MonthDto,
  SavingsOverviewDto,
  SessionDto,
  TagSummaryRow,
  TransferDto,
} from '@budget/shared';
import { api, qs } from './api';
import { useToast } from '../components/toast';

export function useSession(): UseQueryResult<SessionDto> {
  return useQuery({ queryKey: ['session'], queryFn: () => api.get<SessionDto>('/session'), staleTime: 60_000 });
}

export function useCatalog(): UseQueryResult<GroupDto[]> {
  return useQuery({ queryKey: ['catalog'], queryFn: () => api.get<GroupDto[]>('/catalog') });
}

export function useMonths(): UseQueryResult<{ months: string[]; current: string }> {
  return useQuery({ queryKey: ['months'], queryFn: () => api.get<{ months: string[]; current: string }>('/months') });
}

export function useMonthDto(month: string): UseQueryResult<MonthDto> {
  return useQuery({ queryKey: ['month', month], queryFn: () => api.get<MonthDto>(`/months/${month}`), retry: false });
}

export function useDashboard(month: string): UseQueryResult<DashboardDto> {
  return useQuery({
    queryKey: ['dashboard', month],
    queryFn: () => api.get<DashboardDto>(`/months/${month}/dashboard`),
    retry: false,
  });
}

export interface ExpenseFiltersState {
  month?: string;
  categoryId?: string;
  tag?: string;
  personId?: string;
  q?: string;
  status?: 'pending' | 'confirmed';
}

export function useExpenses(filters: ExpenseFiltersState): UseQueryResult<ExpenseDto[]> {
  return useQuery({
    queryKey: ['expenses', filters],
    queryFn: () => api.get<ExpenseDto[]>(`/expenses${qs({ ...filters })}`),
  });
}

export function useBalance(month: string): UseQueryResult<BalanceDto> {
  return useQuery({ queryKey: ['balance', month], queryFn: () => api.get<BalanceDto>(`/balance?month=${month}`) });
}

export function useTags(): UseQueryResult<{ name: string; count: number }[]> {
  return useQuery({ queryKey: ['tags'], queryFn: () => api.get<{ name: string; count: number }[]>('/tags') });
}

export function useTagSummary(): UseQueryResult<TagSummaryRow[]> {
  return useQuery({ queryKey: ['tag-summary'], queryFn: () => api.get<TagSummaryRow[]>('/tags/summary') });
}

export function useSavings(): UseQueryResult<SavingsOverviewDto> {
  return useQuery({ queryKey: ['savings'], queryFn: () => api.get<SavingsOverviewDto>('/savings') });
}

export function useTransfers(month: string): UseQueryResult<TransferDto[]> {
  return useQuery({ queryKey: ['transfers', month], queryFn: () => api.get<TransferDto[]>(`/months/${month}/transfers`) });
}

/**
 * Runs a write call, refreshes every cached query (the data set is small, so this keeps all screens
 * consistent) and reports API errors as a toast.
 */
export function useAction<TInput, TResult = unknown>(
  fn: (input: TInput) => Promise<TResult>,
  opts: { success?: string; onSuccess?: (result: TResult) => void } = {},
): UseMutationResult<TResult, Error, TInput> {
  const qc = useQueryClient();
  const toast = useToast();
  return useMutation({
    mutationFn: fn,
    onSuccess: async (result) => {
      await qc.invalidateQueries();
      if (opts.success) toast.show(opts.success);
      opts.onSuccess?.(result);
    },
    onError: (err) => toast.show(err.message, 'error'),
  });
}
