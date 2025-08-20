import { useToast, UseToastOptions } from '@chakra-ui/react';

type ToastStatus = 'success' | 'error' | 'warning' | 'info' | 'loading';

export function useAppToast() {
  const toast = useToast();

  const base: UseToastOptions = {
    duration: 5000,
    isClosable: true,
    position: 'top-right'
  };

  function show(
    title: string,
    description: string,
    status: ToastStatus,
    options?: UseToastOptions
  ) {
    toast({ title, description, status, ...base, ...options });
  }

  return {
    success: (title: string, description: string, options?: UseToastOptions) =>
      show(title, description, 'success', options),
    error: (title: string, description: string, options?: UseToastOptions) =>
      show(title, description, 'error', options),
    warning: (title: string, description: string, options?: UseToastOptions) =>
      show(title, description, 'warning', options),
    info: (title: string, description: string, options?: UseToastOptions) =>
      show(title, description, 'info', options),
  };
}



