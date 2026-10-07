import { Component, type ErrorInfo, type ReactNode } from "react";

import ErrorPage from "@/pages/ErrorPage";

interface RouteErrorBoundaryProps {
  children: ReactNode;
}

interface RouteErrorBoundaryState {
  hasError: boolean;
}

/**
 * 화면 코드를 못 받거나 그리다 터지면 빈 화면 대신 500 화면을 보여 준다.
 * 주소마다 새로 만들어지는 칸 안에 두어, 다른 화면으로 가면 오류 상태가 함께 걷힌다.
 */
export default class RouteErrorBoundary extends Component<RouteErrorBoundaryProps, RouteErrorBoundaryState> {
  override state: RouteErrorBoundaryState = { hasError: false };

  static getDerivedStateFromError(): RouteErrorBoundaryState {
    return { hasError: true };
  }

  override componentDidCatch(error: unknown, info: ErrorInfo) {
    console.error(error, info.componentStack);
  }

  override render() {
    return this.state.hasError ? <ErrorPage kind="500" /> : this.props.children;
  }
}
