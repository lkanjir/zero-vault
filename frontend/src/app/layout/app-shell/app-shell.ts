import { Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { Topbar } from "./topbar/topbar";

@Component({
  selector: 'app-app-shell',
  imports: [RouterOutlet, Topbar],
  templateUrl: './app-shell.html',
  styleUrl: './app-shell.css',
})
export class AppShell {}
