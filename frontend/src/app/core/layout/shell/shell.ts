import { Component } from '@angular/core';
import { Sidebar } from "../sidebar/sidebar";
import { Topbar } from "../topbar/topbar";
import { RouterOutlet } from "@angular/router";

@Component({
  selector: 'app-shell',
  imports: [Sidebar, Topbar, RouterOutlet],
  templateUrl: './shell.html',
  styleUrl: './shell.css',
})
export class Shell {}
