'use client';

import MenuIcon from '@mui/icons-material/Menu';
import AppBar from '@mui/material/AppBar';
import Button from '@mui/material/Button';
import Box from '@mui/material/Box';
import Drawer from '@mui/material/Drawer';
import IconButton from '@mui/material/IconButton';
import List from '@mui/material/List';
import ListItemButton from '@mui/material/ListItemButton';
import ListItemText from '@mui/material/ListItemText';
import ListSubheader from '@mui/material/ListSubheader';
import Toolbar from '@mui/material/Toolbar';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import { ROLE_LABELS, type Role } from '@smartcode/shared';
import NextLink from 'next/link';
import { type ReactNode, useState } from 'react';
import { groupedNavigation } from '@/features/navigation/navigation';
import { tokens } from '@/theme/tokens';
import { BrandLogo } from './BrandLogo';
import { EnvironmentBadge } from './EnvironmentBadge';
import { NotificationBell } from './NotificationBell';

export interface AppShellProps {
  role: Role;
  title: string;
  currentPath: string;
  appEnv: string;
  /** Signed-in person; shown in the header with a sign-out action. */
  userName?: string;
  onSignOut?: () => void;
  children: ReactNode;
}

function Sidebar({ role, currentPath }: { role: Role; currentPath: string }) {
  const groups = groupedNavigation(role);
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <Box sx={{ px: 2.5, pt: 2.5, pb: 2 }}>
        <BrandLogo width={200} priority />
      </Box>
      <Box component="nav" aria-label="Main" sx={{ flex: 1, overflowY: 'auto', pb: 2 }}>
        {groups.map(({ group, items }) => (
          <List
            key={group}
            dense
            subheader={
              <ListSubheader
                disableSticky
                sx={{
                  bgcolor: 'transparent',
                  lineHeight: 2.5,
                  color: tokens.color.inkMuted,
                  fontWeight: 600,
                }}
              >
                {group}
              </ListSubheader>
            }
          >
            {items.map((item) => {
              const selected = currentPath === item.href;
              const button = (
                <ListItemButton
                  key={item.key}
                  component={item.available ? NextLink : 'div'}
                  href={item.available ? item.href : undefined}
                  selected={selected}
                  disabled={!item.available}
                  aria-current={selected ? 'page' : undefined}
                  sx={{
                    mx: 1,
                    borderRadius: `${tokens.radius.control}px`,
                    '&.Mui-selected': { bgcolor: '#E8F1FE', color: tokens.color.actionStrong },
                  }}
                >
                  <ListItemText
                    primary={item.label}
                    slotProps={{ primary: { sx: { fontWeight: selected ? 600 : 500 } } }}
                  />
                </ListItemButton>
              );
              return item.available ? (
                button
              ) : (
                <Tooltip key={item.key} title="Not available yet" placement="right">
                  <span>{button}</span>
                </Tooltip>
              );
            })}
          </List>
        ))}
      </Box>
    </Box>
  );
}

/** Authenticated workspace frame: logo sidebar (role-aware menu) + header. Used by every role's pages. */
export function AppShell({ role, title, currentPath, appEnv, userName, onSignOut, children }: AppShellProps) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const width = tokens.sidebarWidth;
  const paperSx = {
    width,
    boxSizing: 'border-box',
    borderRight: `1px solid ${tokens.color.line}`,
    bgcolor: tokens.color.surface,
  } as const;

  return (
    <Box sx={{ display: 'flex', minHeight: '100vh', bgcolor: 'background.default' }}>
      <Drawer
        variant="temporary"
        open={mobileOpen}
        onClose={() => setMobileOpen(false)}
        ModalProps={{ keepMounted: true }}
        sx={{ display: { xs: 'block', md: 'none' }, '& .MuiDrawer-paper': paperSx }}
      >
        <Sidebar role={role} currentPath={currentPath} />
      </Drawer>
      <Drawer
        variant="permanent"
        open
        sx={{ display: { xs: 'none', md: 'block' }, width, flexShrink: 0, '& .MuiDrawer-paper': paperSx }}
      >
        <Sidebar role={role} currentPath={currentPath} />
      </Drawer>

      <Box sx={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
        <AppBar
          position="sticky"
          color="inherit"
          elevation={0}
          sx={{ borderBottom: `1px solid ${tokens.color.line}`, bgcolor: 'background.paper' }}
        >
          <Toolbar sx={{ gap: 2 }}>
            <IconButton
              edge="start"
              aria-label="Open navigation"
              onClick={() => setMobileOpen(true)}
              sx={{ display: { md: 'none' } }}
            >
              <MenuIcon />
            </IconButton>
            <Box sx={{ display: { xs: 'block', md: 'none' } }}>
              <BrandLogo variant="mark" width={32} />
            </Box>
            <Typography variant="h5" component="h1" sx={{ flex: 1, minWidth: 0 }} noWrap>
              {title}
            </Typography>
            <EnvironmentBadge appEnv={appEnv} />
            {userName && <NotificationBell />}
            <Typography variant="body2" color="text.secondary" sx={{ display: { xs: 'none', sm: 'block' } }}>
              {userName ? `${userName} · ${ROLE_LABELS[role]}` : ROLE_LABELS[role]}
            </Typography>
            {onSignOut && (
              <Button size="small" variant="outlined" onClick={onSignOut}>
                Sign out
              </Button>
            )}
          </Toolbar>
        </AppBar>
        <Box component="main" id="main" sx={{ flex: 1, p: { xs: 2, md: 4 } }}>
          {children}
        </Box>
      </Box>
    </Box>
  );
}
