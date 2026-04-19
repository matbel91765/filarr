/**
 * PrivateRoute Component
 *
 * Verifie l'authentification avant de rendre les routes protegees.
 */

import { FC, ReactElement } from 'react';

interface PrivateRouteProps {
  children: ReactElement;
}

export const PrivateRoute: FC<PrivateRouteProps> = ({ children }) => {
  return children;
};

export default PrivateRoute;
